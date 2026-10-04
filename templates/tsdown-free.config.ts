import path from 'node:path';

import original from './tsdown-worker.config.ts';

export default {
    ...original,
    plugins: [
        {
            name: 'free-profile-browser',
            resolveId(source: string) {
                if (source === '@/utils/playwright' || source.endsWith('/playwright.worker')) {
                    return path.resolve('./.dev.playwright-disabled.ts');
                }
            },
        },
        ...(original.plugins || []),
    ],
};
