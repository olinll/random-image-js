/**
 * 调试端点 /api/status（构建时由 build.js 生成）
 */
const COUNTS = {"h":979,"v":3596};
const BUILD_TIME = "2026-07-02T13:47:20.476Z";

export async function onRequest(context) {
    try {
        const url = new URL(context.request.url);
        return new Response(JSON.stringify({
            ok: true,
            counts: COUNTS,
            build_time: BUILD_TIME,
            url: url.href
        }, null, 2), {
            headers: { 'content-type': 'application/json; charset=utf-8' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e && e.message }), { status: 500 });
    }
}
