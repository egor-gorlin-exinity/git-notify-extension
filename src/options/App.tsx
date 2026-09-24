import * as browser from 'webextension-polyfill';
import { useState, useEffect } from 'react';
import { Box, Button, Flash, TextInput, Tooltip, Octicon, FormControl, Select, ThemeProvider } from '@primer/react';
import { InfoIcon, ClockIcon } from '@primer/octicons-react';
import './style.css';
import { Configuration, TabId } from '../common/types';
import { AccountConfiguration } from './components/Account';
import { getConfiguration, updateConfiguration, clearAccountStorage } from '../common/storage';
import { login, logout } from '../background/auth/oauth';

const getSettings = getConfiguration(['accounts', 'refreshRate', 'defaultTab', 'alertBadgeCounters', 'mode']);

export const App = () => {
    const [configuration, setConfiguration] = useState<Configuration>();
    const [loginError, setLoginError] = useState<{ message: string; cancelled: boolean } | null>(null);

    useEffect(() => {
        getSettings.then((settings) => {
            if (!settings) {
                return;
            }
            setConfiguration(settings);
        });
    }, []);

    const updateConfigurationInMemory = async (data: Partial<Configuration>) => {
        if (!configuration) {
            return;
        }
        setConfiguration({ ...configuration, ...data });
        await updateConfiguration(data);
        if (data.refreshRate) {
            await browser.runtime.sendMessage({ type: 'updateRefreshRate', interval: data.refreshRate });
        }
    };

    const addNewAccount = async () => {
        setLoginError(null);
        try {
            const account = await login();
            // Re-read from storage rather than trusting in-memory `configuration.accounts`: the
            // background worker rotates other accounts' tokens independently, and this page's state
            // can be stale by the time the user clicks. Writing back a stale copy would roll those
            // accounts' tokens back to dead values (see Task 6 fix round 1, findings 2/3).
            const settings = await getConfiguration(['accounts']);
            const accounts = settings.accounts || [];
            // Повторный вход тем же пользователем обновляет токены его аккаунта, а не заводит копию.
            const index = accounts.findIndex((existing) => existing.userId === account.userId);
            if (index === -1) {
                accounts.push(account);
            } else {
                const { accessToken, refreshToken, expiresAt } = account;
                accounts[index] = { ...accounts[index], accessToken, refreshToken, expiresAt };
            }
            await updateConfigurationInMemory({ accounts });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const cancelled = /did not approve/i.test(message);
            if (!cancelled) {
                console.error('Login failed:', error);
            }
            setLoginError({ message: cancelled ? 'Sign-in cancelled.' : message, cancelled });
        }
    };

    const removeAccount = async (index: number) => {
        // Same reason as addNewAccount: read fresh so we logout()/persist the account's real,
        // currently-valid tokens instead of a stale in-memory snapshot.
        const settings = await getConfiguration(['accounts']);
        const accounts = settings.accounts || [];
        await logout(accounts[index]);
        void clearAccountStorage(accounts[index].uuid);
        accounts.splice(index, 1);
        await updateConfigurationInMemory({ accounts });
    };

    return (
        <ThemeProvider colorMode="auto">
            <Box display="grid" sx={{ width: 500, p: 2, pl: 4, pr: 6, bg: 'canvas.default', gap: 1 }}>
                <h2>Main Settings</h2>
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
                    <FormControl>
                        <FormControl.Label>
                            Refresh rate in seconds{' '}
                            <Tooltip aria-label="It is not recommended to go below 30 seconds.">
                                <Octicon icon={InfoIcon} size={15} color="blue.5" />
                            </Tooltip>
                        </FormControl.Label>
                        <TextInput
                            leadingVisual={ClockIcon}
                            block
                            type="number"
                            name="refreshRate"
                            min="20"
                            value={configuration?.refreshRate}
                            placeholder="0"
                            onChange={(e) => updateConfigurationInMemory({ refreshRate: parseInt(e.target.value) })}
                            sx={{ boxSizing: 'border-box' }}
                        />
                    </FormControl>
                    <FormControl>
                        <FormControl.Label>Default tab on opening</FormControl.Label>
                        <Select
                            name="default-tab"
                            onChange={(e) => updateConfigurationInMemory({ defaultTab: e.target.value as TabId })}
                        >
                            <Select.Option selected={configuration?.defaultTab === 'to_review'} value="to_review">
                                To Review
                            </Select.Option>
                            <Select.Option selected={configuration?.defaultTab === 'under_review'} value="under_review">
                                Under Review
                            </Select.Option>
                            <Select.Option selected={configuration?.defaultTab === 'drafts'} value="drafts">
                                Drafts
                            </Select.Option>
                            <Select.Option selected={configuration?.defaultTab === 'issues'} value="issues">
                                Issues
                            </Select.Option>
                            <Select.Option selected={configuration?.defaultTab === 'todo_list'} value="todo_list">
                                To-Do List
                            </Select.Option>
                        </Select>
                    </FormControl>
                    <FormControl>
                        <FormControl.Label>
                            Alert badge counters{' '}
                            <Tooltip aria-label="You can select multiple counters but display might be too small.">
                                <Octicon icon={InfoIcon} size={15} color="blue.5" />
                            </Tooltip>
                        </FormControl.Label>
                        <select
                            name="alert-badge-counters"
                            multiple
                            onChange={(event) => {
                                const options = [...event.target.selectedOptions].map((option) =>
                                    parseInt(option.value)
                                );
                                updateConfigurationInMemory({ alertBadgeCounters: options });
                            }}
                        >
                            <option selected={configuration?.alertBadgeCounters.includes(0)} value="0">
                                To Review
                            </option>
                            <option selected={configuration?.alertBadgeCounters.includes(1)} value="1">
                                Reviewed by others
                            </option>
                            <option selected={configuration?.alertBadgeCounters.includes(2)} value="2">
                                Issues
                            </option>
                            <option selected={configuration?.alertBadgeCounters.includes(3)} value="3">
                                To-Do List
                            </option>
                        </select>
                    </FormControl>
                </Box>
                <h2>Accounts</h2>
                {configuration?.accounts.map((account, index) => (
                    // key по uuid, а не по индексу: при удалении аккаунта React иначе переиспользует
                    // инстанс, и выживший аккаунт рисуется с полями удалённого (useState в Account.tsx
                    // засевается один раз на монтировании).
                    <AccountConfiguration
                        key={account.uuid}
                        account={account}
                        removeAccount={() => removeAccount(index)}
                    />
                ))}
                <Button onClick={addNewAccount}>Sign in with GitLab</Button>
                {loginError && (
                    <Flash variant={loginError.cancelled ? 'default' : 'danger'}>{loginError.message}</Flash>
                )}
            </Box>
        </ThemeProvider>
    );
};
