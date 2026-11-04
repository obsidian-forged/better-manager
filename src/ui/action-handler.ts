/** DOM/SDK 回调只返回 void，异步失败统一交给界面处理；Keep async failures at the UI boundary. */
export function createActionHandler(onError: (error: unknown) => void) {
    return <Args extends unknown[]>(work: (...args: Args) => Promise<unknown>): ((...args: Args) => void) =>
        (...args: Args): void => {
            try {
                void work(...args).catch(onError);
            } catch (error) {
                onError(error);
            }
        };
}
