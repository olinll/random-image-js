/**
 * 随机图 URL 端点 /random/v（构建时由 build.js 生成）
 * 不依赖 new URL、不依赖 params，避免方括号文件名被打包器搞坏
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
        const request = context.request;
        const total = COUNTS['v'];

        if (!total || total < 1) {
            return jsonResponse({ error: 'No images for type v' }, 404);
        }

        const idx = Math.floor(Math.random() * total) + 1;
        const host = (request && request.headers && request.headers.get('host')) || 'pic.olinl.com';
        const proto = (request && request.headers && request.headers.get('x-forwarded-proto')) || 'https';
        const target = proto + '://' + host + '/ri/v/' + idx + '.webp';

        return new Response(null, {
            status: 302,
            headers: { 'location': target }
        });
    } catch (e) {
        return jsonResponse({
            error: 'function crashed',
            message: e && e.message,
            stack: e && e.stack
        }, 500);
    }
}
