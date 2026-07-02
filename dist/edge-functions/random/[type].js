/**
 * 随机图 URL 端点（Tencent EdgeOne Pages Functions）
 * GET /random/h → 302 重定向到 /ri/h/{随机}.webp
 * GET /random/v → 302 重定向到 /ri/v/{随机}.webp
 * GET /random/h/ 或 /random/v/ 也支持
 */
export async function onRequest(context) {
    const { request, params } = context;
    const url = new URL(request.url);

    // 兼容 /random/h 和 /random/h/ 两种调用
    let type = String(params.type || '').replace(/\/$/, '');
    if (type !== 'h' && type !== 'v') {
        return new Response(
            JSON.stringify({ error: 'Invalid type. Use /random/h or /random/v.' }),
            { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' } }
        );
    }

    // 读 counts.json（同源静态资源，边缘缓存友好）
    let counts;
    try {
        const r = await fetch(new URL('/counts.json', url));
        if (!r.ok) throw new Error('counts.json status ' + r.status);
        counts = await r.json();
    } catch (e) {
        return new Response(
            JSON.stringify({ error: 'Failed to load counts.json', detail: String(e) }),
            { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
        );
    }

    const total = counts[type];
    if (!total || total < 1) {
        return new Response(
            JSON.stringify({ error: 'No images for type ' + type }),
            { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } }
        );
    }

    const idx = Math.floor(Math.random() * total) + 1;
    const target = new URL(`/ri/${type}/${idx}.webp`, url);
    return Response.redirect(target, 302);
}
