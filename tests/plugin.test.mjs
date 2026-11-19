import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const directory = mkdtempSync(join(tmpdir(), "cra-github-issues-test-"));
const archive = join(directory, "plugin.zip");
const input = { settings: {}, filters: [], state: {} };
let entry;

before(() => {
    const packager = fileURLToPath(new URL("../scripts/package.mjs", import.meta.url));
    execFileSync(execPath, [packager, archive]);
    entry = readEntry("main.js");
});

after(() => rmSync(directory, { recursive: true, force: true }));

/** @param {string} name */
function readEntry(name) {
    return execFileSync("unzip", ["-p", archive, name], { encoding: "utf8" });
}

/** @param {(url: string, options: {headers: Record<string, string>}) => object} [fetch] */
function loadProvider(fetch = () => assert.fail("Unexpected network request")) {
    return runInNewContext("(function () {" + entry + "\n})()", {
        cra: { session: { fetch } },
    }, { filename: "main.js", timeout: 1000 });
}

/**
 * @param {number} number
 * @param {string} owner
 * @param {string} name
 * @param {string[]} assignees
 */
function issue(number, owner, name, assignees = []) {
    return {
        num: number, hl_title: "Update &amp; review #" + number, state: "open",
        author_name: "contributor", assignees,
        created: "2026-01-01T00:00:00Z",
        issue: { issue: { pull_request_id: null } },
        repo: { repository: { owner_login: owner, name } },
    };
}

/**
 * @param {string} url
 * @param {string} login
 * @param {object[]} results
 * @param {{page?: number, pages?: number, count?: number}} [pagination]
 */
function page(url, login, results, { page = 1, pages = 1, count = results.length } = {}) {
    const payload = { type: "issues", logged_in: Boolean(login), results,
        page, page_count: pages, result_count: count, errors: [] };
    return {
        status: 200, url,
        body: '<meta name="user-login" content="' + login + '">' +
            '<script type="application/json" data-target="react-app.embeddedData">' +
            JSON.stringify({ payload }) + "</script>",
    };
}

test("Cra can describe the installed package, create the folder and get its sign-in action", () => {
    const manifest = JSON.parse(readEntry("manifest.json"));
    assert.deepEqual(manifest.sessionOrigins, ["https://github.com"]);
    const provider = loadProvider();
    assert.equal(provider.describe().folderTitle, "GitHub Issues");
    assert.notEqual(readEntry(provider.describe().icon), "");
    const signIn = new URL(provider.signIn(input).url);
    assert.equal(signIn.origin + signIn.pathname, "https://github.com/login");
    assert.equal(provider.pageChanged({ state: input.state, url: "https://github.com/" }).checkSignIn, true);
    assert.equal(provider.pageChanged({ state: input.state, url: "https://github.com.example.test/" }).checkSignIn, false);
});

test("search uses the Space's viewer and keeps issues regardless of assignee across repositories", () => {
    for (const login of ["alex", "sam"]) {
        const provider = loadProvider((url, options) => {
            const request = new URL(url);
            assert.equal(request.origin + request.pathname, "https://github.com/search");
            assert.equal(request.searchParams.get("type"), "issues");
            assert.equal(request.searchParams.get("q"), "is:issue is:open user:@me sort:created-desc");
            assert.equal(options.headers.Accept, "text/html");
            return page(url, login, [issue(1, login, "one"), issue(1, login, "two", ["another-user"])]);
        });
        const items = JSON.parse(JSON.stringify(provider.refresh(input).items));
        assert.deepEqual(items.map(item => item.url), [
            "https://github.com/" + login + "/one/issues/1",
            "https://github.com/" + login + "/two/issues/1",
        ]);
        assert.equal(items[0].group, login + "/one");
        assert.equal(items[0].title, "Update & review #1");
        assert.equal(items[0].createdAt, 1767225600);
    }
});

test("refresh reads every search page", () => {
    const requests = [];
    const provider = loadProvider(url => {
        const index = Number(new URL(url).searchParams.get("p") ?? 1);
        requests.push(index);
        return page(url, "alex", [issue(index, "alex", "repo")], { page: index, pages: 2, count: 2 });
    });
    assert.equal(provider.refresh(input).items.length, 2);
    assert.deepEqual(requests, [1, 2]);
});

test("an empty authenticated result clears the snapshot", () => {
    const provider = loadProvider(url => page(url, "alex", [], { pages: 0 }));
    assert.equal(provider.refresh(input).items.length, 0);
});

test("a logged-out web response requests sign-in", () => {
    const provider = loadProvider(url => page(url, "", []));
    assert.throws(() => provider.refresh(input), { message: "notSignedIn" });
});

test("a GitHub login redirect requests sign-in", () => {
    const provider = loadProvider(() => ({ status: 200, url: "https://github.com/login", body: "" }));
    assert.throws(() => provider.refresh(input), { message: "notSignedIn" });
});

test("rows from a different account or a PR are rejected", () => {
    const pull = issue(2, "alex", "repo");
    pull.issue.issue.pull_request_id = 42;
    for (const row of [issue(1, "acme", "repo"), pull, { ...issue(1, "alex", "repo"), state: "closed" }]) {
        const provider = loadProvider(url => page(url, "alex", [row]));
        assert.throws(() => provider.refresh(input), { message: "unexpectedPage" });
    }
});

test("a rate-limited later page never replaces the folder with a partial list", () => {
    const provider = loadProvider(url => new URL(url).searchParams.get("p") === "2"
        ? { status: 429, url, body: "Too many requests" }
        : page(url, "alex", [issue(1, "alex", "repo")], { pages: 2, count: 2 }));
    assert.throws(() => provider.refresh(input), { message: "rateLimited" });
});

test("a truncated or unrecognized result is not an empty successful refresh", () => {
    const truncated = loadProvider(url => page(url, "alex", [issue(1, "alex", "repo")], { count: 5 }));
    assert.throws(() => truncated.refresh(input), { message: "unexpectedPage" });
    const malformed = loadProvider(url => ({ status: 200, url, body: "<html lang=\"en\">Something changed</html>" }));
    assert.throws(() => malformed.refresh(input), { message: "unexpectedPage" });
});

test("an account change between pages prevents mixing snapshots", () => {
    const provider = loadProvider(url => {
        const index = Number(new URL(url).searchParams.get("p") ?? 1);
        const owner = index === 1 ? "alex" : "sam";
        return page(url, owner, [issue(index, owner, "repo")], { page: index, pages: 2, count: 2 });
    });
    assert.throws(() => provider.refresh(input), { message: "unexpectedPage" });
});
