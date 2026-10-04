// Browser-dependent routes are deferred in this zero-cost deployment profile.
export const setBrowserBinding = (_binding: unknown) => {};
export const setPlaywrightServiceBinding = (_binding: unknown, _origin?: string) => {};
const unavailable = () => {
    throw new Error('This route requires a browser runtime and is not enabled on this free RSSHub instance.');
};
export default unavailable;
export const getPlaywrightPage = unavailable;
