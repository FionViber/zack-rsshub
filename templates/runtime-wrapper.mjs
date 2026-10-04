import rsshub from './dist-worker/worker.mjs';

export class RSSHubRuntime {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }

    fetch(request) {
        return rsshub.fetch(request, this.env, {
            waitUntil: (promise) => this.state.waitUntil(promise),
            passThroughOnException() {},
        });
    }
}

export default {
    fetch(request, env) {
        return env.RSSHUB_RUNTIME.get(env.RSSHUB_RUNTIME.idFromName('rsshub')).fetch(request);
    },
};
