type SearchResponse = { status: number; url: string; body: string };
type CraBridge = {
    session: { fetch(url: string, options: { headers: { Accept: string } }): SearchResponse };
};
type FolderState = Record<string, string>;
type IssueTab = {
    id: string;
    url: string;
    title: string;
    group: string;
    subtitle?: string;
    createdAt?: number;
};
type SearchPage = {
    login: string;
    pageCount: number;
    total: number;
    issues: IssueTab[];
};

declare const cra: CraBridge;
declare function registerProvider(provider: object): void;

const github = "https://github.com";
const searchQuery = "is:issue is:open user:@me sort:created-desc";
const maxRequests = 200;
const maxItems = 10_000;

function searchPath(page: number): string {
    return "/search?type=issues&q=" + encodeURIComponent(searchQuery) + "&p=" + page;
}

function record(value: unknown): Record<string, unknown> | undefined {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function segment(value: unknown): value is string {
    return typeof value === "string" && value !== "." && value !== ".." && /^[\w.-]+$/.test(value);
}

function plainTitle(value: string): string {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return value.replace(/<[^>]+>/g, "")
        .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity: string, key: string): string => {
            if (key[0] !== "#") return Object.hasOwn(named, key) ? named[key] : entity;
            const hexadecimal = key[1].toLowerCase() === "x";
            const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
            return codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff)
                ? String.fromCodePoint(codePoint) : entity;
        }).trim();
}

function issueTab(value: unknown, login: string): IssueTab {
    const issue = record(value);
    const repository = record(record(issue?.repo)?.repository);
    if (!issue || !repository || !segment(repository.owner_login) || !segment(repository.name) ||
        repository.owner_login.toLowerCase() !== login || issue.state !== "open" ||
        record(record(issue.issue)?.issue)?.pull_request_id != null ||
        !nonNegativeInteger(issue.num) || issue.num === 0 || typeof issue.hl_title !== "string") {
        throw new Error("unexpectedPage");
    }

    const title = plainTitle(issue.hl_title);
    if (!title) throw new Error("unexpectedPage");

    const group = repository.owner_login + "/" + repository.name;
    const url = github + "/" + group + "/issues/" + issue.num;
    const created = typeof issue.created === "string" ? Date.parse(issue.created) : NaN;
    return {
        id: url,
        url,
        title,
        group,
        subtitle: typeof issue.author_name === "string" ? issue.author_name : undefined,
        createdAt: Number.isFinite(created) ? created / 1000 : undefined,
    };
}

// GitHub's public search page includes the server-rendered results in its hydration payload.
function issuePayload(html: string): Record<string, unknown> {
    for (const script of html.matchAll(/<script\b[^>]*\bdata-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/g)) {
        let data: unknown;
        try {
            data = JSON.parse(script[1]);
        } catch {
            continue;
        }
        const payload = record(record(data)?.payload);
        if (payload?.type === "issues") return payload;
    }
    throw new Error("unexpectedPage");
}

function readPage(bridge: CraBridge, page: number): SearchPage {
    const response = bridge.session.fetch(github + searchPath(page), { headers: { Accept: "text/html" } });
    if (response.status === 0) throw new Error("network");
    if (response.status === 429 || (response.status === 403 && /rate limit/i.test(response.body))) {
        throw new Error("rateLimited");
    }
    if (response.status === 401 || /^https:\/\/github\.com\/(?:login|session)(?:[/?#]|$)/.test(response.url)) {
        throw new Error("notSignedIn");
    }
    if (response.status !== 200 || !/^https:\/\/github\.com\/search(?:[?#]|$)/.test(response.url)) {
        throw new Error("unexpectedPage");
    }

    const login = /<meta\b[^>]*\bname="user-login"\s+content="([a-z0-9-]*)"/i.exec(response.body)?.[1];
    if (login === "") throw new Error("notSignedIn");
    if (login === undefined) throw new Error("unexpectedPage");

    const payload = issuePayload(response.body);
    if (payload.logged_in === false) throw new Error("notSignedIn");
    const { results, page: actualPage, page_count: pageCount, result_count: total, errors } = payload;
    if (!Array.isArray(results) || actualPage !== page || !nonNegativeInteger(pageCount) ||
        !nonNegativeInteger(total) || (Array.isArray(errors) && errors.length > 0) ||
        (total > 0 && (pageCount < page || results.length === 0))) {
        throw new Error("unexpectedPage");
    }

    const owner = login.toLowerCase();
    return { login: owner, pageCount, total, issues: results.map((item: unknown) => issueTab(item, owner)) };
}

function loadIssues(bridge: CraBridge): IssueTab[] {
    const first = readPage(bridge, 1);
    if (first.pageCount > maxRequests || first.total > maxItems) throw new Error("unexpectedPage");

    const issues = new Map(first.issues.map(item => [item.id, item]));
    for (let index = 2; index <= first.pageCount; index++) {
        const next = readPage(bridge, index);
        if (next.login !== first.login || next.pageCount !== first.pageCount || next.total !== first.total) {
            throw new Error("unexpectedPage");
        }
        for (const item of next.issues) issues.set(item.id, item);
    }
    if (issues.size !== first.total) throw new Error("unexpectedPage");
    return [...issues.values()];
}

function createGitHubIssuesProvider(bridge: CraBridge) {
    return {
        describe() {
            return {
                folderTitle: "GitHub Issues",
                menuTitle: "GitHub Issues",
                icon: "icon.svg",
                filters: [],
                groups: { title: "Repositories", description: "Repositories with open issues you can access." },
                statusMessages: {
                    notSignedIn: "Sign in to GitHub in this Space’s profile.",
                    rateLimited: "GitHub’s rate limit was reached.",
                    network: "Could not connect to GitHub.",
                    unexpectedPage: "GitHub did not return a complete issue list.",
                },
            };
        },
        refresh(): { items: IssueTab[]; actions: []; preservedGroups: [] } {
            return { items: loadIssues(bridge), actions: [], preservedGroups: [] };
        },
        signIn() {
            return {
                title: "Sign In to GitHub…",
                url: github + "/login?return_to=" + encodeURIComponent(searchPath(1)),
                warning: "Sign in to GitHub in this Space.",
                emptyText: "No open issues in your repositories.",
                failureText: "Could not load your GitHub issues. Click to open GitHub search.",
                failureURL: github + searchPath(1),
                instanceLabel: "GitHub",
            };
        },
        pageChanged(input: { url: string; state?: FolderState }): {
            state: FolderState; refreshAfter: []; checkSignIn: boolean;
        } {
            return { state: input.state ?? {}, refreshAfter: [], checkSignIn: input.url.startsWith(github + "/") };
        },
    };
}

registerProvider(createGitHubIssuesProvider(cra));
