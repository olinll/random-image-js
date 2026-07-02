/**
 * 随机图 URL 端点（构建时由 build.js 生成）
 * 平台: Cloudflare Pages Functions
 * COUNTS 由构建脚本注入，无需 fetch
 */
const COUNTS = {"h":979,"v":3596};

function jsonResponse(body, status) {
    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' }
    });
}

export async function onRequest(context) {
    try {
        const { request, params } = context;
        const url = new URL(request.url);
        let type = String(params.type || '').replace(/\/$/, '');

        if (type !== 'h' && type !== 'v') {
            return jsonResponse({ error: 'Invalid type. Use /random/h or /random/v.' }, 400);
        }

        const total = COUNTS[type];
        if (!total || total < 1) {
            return jsonResponse({ error: 'No images for type ' + type }, 404);
        }

        const idx = Math.floor(Math.random() * total) + 1;
        return Response.redirect(new URL('/ri/' + type + '/' + idx + '.webp', url), 302);
    } catch (e) {
        return jsonResponse({
            error: 'function crashed',
            message: e && e.message,
            stack: e && e.stack
        }, 500);
    }
}
