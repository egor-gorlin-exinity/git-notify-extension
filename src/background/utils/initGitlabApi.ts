import { Gitlab } from '@gitbeaker/rest';
import { GitLabTokenNotSet } from '../../common/errors';
import { Account, GitlabAPI } from '../../common/types';
import { getFreshAccessToken } from '../auth/oauth';

interface InitGitlabApiParams {
    account: Account;
}

export const initGitlabApi = async (params: InitGitlabApiParams): Promise<GitlabAPI> => {
    const { account } = params;

    if (!account) {
        throw new GitLabTokenNotSet();
    }

    // host не задаётся: дефолт @gitbeaker/rest — https://gitlab.com, единственный поддерживаемый инстанс.
    return new Gitlab({
        oauthToken: await getFreshAccessToken(account),
        queryTimeout: 10000
    });
};
