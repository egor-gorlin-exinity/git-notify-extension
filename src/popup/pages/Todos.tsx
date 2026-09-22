import { ActionList } from '@primer/react';
import { TodoItem } from '../components/TodoItem';
import { EmptyItems } from '../components/EmptyItems';
import { TodoSchema } from '@gitbeaker/rest';

interface Props {
    todos: TodoSchema[];
}

export const Todos = (props: Props): JSX.Element => {
    const todosLength = props.todos.length;

    if (!props.todos || todosLength === 0) {
        return <EmptyItems />;
    }

    return (
        <>
            {todosLength > 1 ? (
                <div className={'subNav'}>
                    <p className={'subNavText'}>{todosLength} tasks to complete</p>
                </div>
            ) : null}
            <ActionList className={'mrList'}>
                {props.todos.map((todo: TodoSchema) => (
                    <TodoItem todo={todo} key={todo.id} />
                ))}
            </ActionList>
        </>
    );
};
