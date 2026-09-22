export class GlobalError extends Error {
    constructor(
        readonly name: string,
        message: string
    ) {
        super(message);
    }
}

export class GitLabTokenNotSet extends GlobalError {
    constructor() {
        super('GitLabTokenNotSet', 'No GitLab token set, visit options.');
    }
}

export class FailFetchSettings extends GlobalError {
    constructor() {
        super('FailFetchSettings', 'Fail fetching settings.');
    }
}

export class GitLabNoAccount extends GlobalError {
    constructor() {
        super('GitLabNoAccount', 'No account were configured.');
    }
}
