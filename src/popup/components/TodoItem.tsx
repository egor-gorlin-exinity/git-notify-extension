import { Avatar, Box, ActionList, Label, Link, Text } from '@primer/react';
import { ClockIcon } from '@primer/octicons-react';
import { calculateTimeElapsed } from '../helpers';
import { createNewTab } from '../utils/createNewTab';
import { TodoSchema } from '@gitbeaker/rest';

interface Props {
    todo: TodoSchema;
}

const actionToText = (author: string, action: string) => {
    switch (action) {
        case 'assigned':
            return author + ' assigned you to';
        case 'mentioned':
            return author + ' mentioned you in';
        case 'build_failed':
            return 'The build failed for';
        case 'approval_required':
            return author + ' set you as an approver on';
        case 'unmergeable':
            return 'The following MR cannot be merged';
        case 'directly_addressed':
            return author + ' tagged you in';
        case 'marked':
            return 'You were marked on';
        default:
            return 'You received a notification';
    }
};

export const TodoItem = (props: Props) => {
    const { todo } = props;

    const timeElapsed = calculateTimeElapsed(todo.created_at);

    return (
        <ActionList.Item className={'mrItem'}>
            <Box display="flex" flexWrap="wrap">
                <Box className={'avatarsList'}>
                    <Avatar src={todo.author.avatar_url} alt={todo.author.name} square size={40} sx={{ mr: 2 }} />
                </Box>
                <Box mr={2} style={{ flex: 1 }}>
                    <Link
                        as="a"
                        href={todo.target_url}
                        onClick={(event: React.MouseEvent<HTMLElement>) => createNewTab(event, todo.target_url)}
                        className={'mrTitle'}
                    >
                        {actionToText(todo.author.name, todo.action_name)} !{String(todo.target.iid)}
                    </Link>
                    <div>
                        <Text className={'todoBody'} title={todo.body}>
                            &#34;{todo.body}&#34;
                        </Text>
                        <Label size="small" sx={{ color: 'neutral.emphasis' }} className={'mrLabel'}>
                            <ClockIcon /> &#160;{timeElapsed}
                        </Label>
                    </div>
                </Box>
            </Box>
        </ActionList.Item>
    );
};
