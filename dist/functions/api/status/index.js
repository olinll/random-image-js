/**
 * 调试端点 /api/status（构建时由 build.js 生成）
 */
const COUNTS = {"h":979,"v":3596};
const BUILD_TIME = "2026-07-02T13:53:08.135Z";

export async function onRequest(context) {
    try {
        const request = context.request;
        const host = (request && request.headers && request.headers.get('host')) || 'pic.olinl.com';
        return jsonResp({
            ok: true,
            counts: COUNTS,
            build_time: BUILD_TIME,
            host: host,
            path: (request && request.url) || ''
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e && e.message }), { status: 500 });
    }
}

function jsonResp(body) {
    return new Response(JSON.stringify(body, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8' }
    });
}
