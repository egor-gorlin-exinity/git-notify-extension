import {
    ExpandedMergeRequestSchema,
    MergeRequestLevelMergeRequestApprovalSchema,
    MergeRequestSchemaWithBasicLabels
} from '@gitbeaker/rest';
import { GitlabAPI, MergeRequestsDetails } from '../../common/types';

interface FetchMRExtraInfoParams {
    gitlabApi: GitlabAPI;
    mrList: MergeRequestSchemaWithBasicLabels[];
}

export const fetchMRExtraInfo = async (params: FetchMRExtraInfoParams): Promise<MergeRequestsDetails[]> => {
    const { gitlabApi, mrList } = params;

    if (mrList.length < 1) {
        return Promise.resolve([]);
    }

    const requestsToExecute = mrList.map((mr) =>
        Promise.all([
            gitlabApi.MergeRequests.show(mr.project_id, mr.iid) as Promise<ExpandedMergeRequestSchema>,
            gitlabApi.MergeRequestApprovals.showConfiguration(mr.project_id, {
                mergerequestIId: mr.iid
            }) as Promise<MergeRequestLevelMergeRequestApprovalSchema>
        ])
    );

    const mrDetails = await Promise.all(requestsToExecute);

    const mrWithDetails = mrDetails.map((mr) => ({
        ...mr[0],
        approvals: mr[1]
    }));

    return mrWithDetails
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .sort((a, b) => {
            if (a.approvals.user_has_approved === b.approvals.user_has_approved) {
                return 0;
            }
            if (a.approvals.user_has_approved) {
                return 1;
            }
            if (b.approvals.user_has_approved) {
                return -1;
            }
            return 0;
        });
};
