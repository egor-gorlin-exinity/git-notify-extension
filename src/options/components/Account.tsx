import * as browser from 'webextension-polyfill';
import { useState } from 'react';
import { InfoIcon, FileDirectoryIcon, PackageDependenciesIcon, TrashIcon } from '@primer/octicons-react';
import { Box, Button, Checkbox, Flash, FormControl, Octicon, Text, TextInput, Tooltip } from '@primer/react';
import { Account } from '../../common/types';
import { updateAccountConfiguration } from '../../common/storage';
import { GITLAB_HOST } from '../../config/config';

interface Props {
    account: Account;
    removeAccount: () => void;
}

export const AccountConfiguration = (props: Props) => {
    const [testSuccess, setTestSuccess] = useState(null);

    const [account, setAccount] = useState<Account>(props.account);

    const setAccountConfiguration = async (data: Partial<Account>) => {
        await updateAccountConfiguration(account.uuid, data);
        setAccount({ ...account, ...data });
    };

    const testConnection = (accountUuid: string) => {
        browser.runtime.sendMessage({ type: 'testAccount', accountUuid }).then((success) => setTestSuccess(success));
    };

    return (
        <Box
            display="grid"
            sx={{
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'border.default',
                p: 3,
                borderRadius: 2,
                gap: 3
            }}
        >
            <Text>
                <strong>Uuid:</strong> {account.uuid}
            </Text>
            <FormControl>
                <FormControl.Label>View draft MRs in &quot;To Review&quot; tab</FormControl.Label>
                <Checkbox
                    type="checkbox"
                    name="draftInToReviewTab"
                    value="View draft in To Review tab"
                    onChange={(e) => setAccountConfiguration({ draftInToReviewTab: e.target.checked })}
                    checked={account.draftInToReviewTab}
                />
                <FormControl.Caption>
                    (merge requests marked as &quot;Draft:&quot; will be ignored if unchecked)
                </FormControl.Caption>
            </FormControl>
            <FormControl>
                <FormControl.Label>
                    Projects directory prefix{' '}
                    <Tooltip
                        aria-label="Sometimes your project are in a sub-directory like 'teams/code/projects/'
                            which makes the project name difficult to read.
                            Set a prefix here that will be substitute each time."
                    >
                        <Octicon icon={InfoIcon} size={15} color="blue.5" />
                    </Tooltip>
                </FormControl.Label>
                <TextInput
                    leadingVisual={FileDirectoryIcon}
                    block
                    name="project-directory-prefix"
                    value={account.projectDirectoryPrefix}
                    placeholder="teams/code/projects/"
                    onChange={(e) => setAccountConfiguration({ projectDirectoryPrefix: e.target.value })}
                    aria-label="project-directory-prefix"
                    sx={{ boxSizing: 'border-box' }}
                />
            </FormControl>

            <Flash variant={props.account.refreshToken ? 'success' : 'warning'}>
                {props.account.refreshToken
                    ? `Signed in to ${GITLAB_HOST} (read-only)`
                    : 'Not signed in — sign in with GitLab again'}
            </Flash>

            <Box display="flex" sx={{ columnGap: 2 }}>
                <Button
                    onClick={() => testConnection(account.uuid)}
                    variant="default"
                    leadingVisual={PackageDependenciesIcon}
                >
                    Test connection
                </Button>
                <Button onClick={props.removeAccount} variant="danger" leadingVisual={TrashIcon}>
                    Remove this account
                </Button>
            </Box>
            {testSuccess !== null && (
                <Flash variant={testSuccess === true ? 'success' : 'danger'}>
                    {testSuccess === true ? 'Connection successful' : 'Could not connect'}
                </Flash>
            )}
        </Box>
    );
};
