const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC_RI = path.join(ROOT, 'ri');
const DIST = path.join(ROOT, 'dist');
const DIST_RI = path.join(DIST, 'ri');
const CONFIG_FILE = path.join(ROOT, 'config.json');

// Helper: Shuffle Array (Fisher-Yates)
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Main function
function build() {
    console.log('Starting build...');

    // Load Config
    let config = { domain: '' };
    
    // Priority 1: Environment Variable
    if (process.env.DOMAIN) {
        config.domain = process.env.DOMAIN;
        console.log('Loaded domain from environment variable.');
    } 
    // Priority 2: Config File
    else if (fs.existsSync(CONFIG_FILE)) {
        try {
            const configContent = fs.readFileSync(CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(configContent);
            if (parsed.domain) {
                config.domain = parsed.domain;
            }
            console.log('Loaded domain from config.json.');
        } catch (e) {
            console.warn('Failed to parse config.json, using default settings.');
        }
    }

    // Normalize domain (remove trailing slash)
    if (config.domain) {
        config.domain = config.domain.replace(/\/$/, '');
    }

    console.log(`Using domain prefix: "${config.domain}"`);

    // 1. Clean/Create Dist
    if (fs.existsSync(DIST)) {
        fs.rmSync(DIST, { recursive: true, force: true });
    }
    fs.mkdirSync(DIST, { recursive: true });
    fs.mkdirSync(DIST_RI, { recursive: true });

    // 2. Process Folders
    const types = ['h', 'v'];
    let counts = {};
    
    types.forEach(type => {
        const srcFolder = path.join(SRC_RI, type);
        const distFolder = path.join(DIST_RI, type);
        
        if (!fs.existsSync(srcFolder)) {
            console.warn(`Source folder not found: ${srcFolder}`);
            counts[type] = 0;
            return;
        }

        fs.mkdirSync(distFolder, { recursive: true });

        // Read and Filter Images
        let files = fs.readdirSync(srcFolder).filter(f => f.match(/\.(webp|jpg|jpeg|png|gif)$/i));
        
        // Shuffle
        files = shuffle(files);

        // Copy and Rename
        files.forEach((file, index) => {
            const srcPath = path.join(srcFolder, file);
            // User requested 1.webp, 2.webp, etc.
            const destPath = path.join(distFolder, `${index + 1}.webp`);
            fs.copyFileSync(srcPath, destPath);
        });

        counts[type] = files.length;
        console.log(`Processed ${type}: ${counts[type]} images.`);
    });

    // 2.5 Write counts.json + 重新生成服务端函数（COUNTS 直接内联，零依赖 fetch）
    fs.writeFileSync(
        path.join(DIST, 'counts.json'),
        JSON.stringify(counts, null, 2)
    );
    console.log(`Wrote dist/counts.json: ${JSON.stringify(counts)}`);

    function makeRandomFn(type) {
        return `/**
 * 随机图 URL 端点 /random/${type}（构建时由 build.js 生成）
 * 不依赖 new URL、不依赖 params，避免方括号文件名被打包器搞坏
 */
const COUNTS = ${JSON.stringify(counts)};

function jsonResponse(body, status) {
    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' }
    });
}

export async function onRequest(context) {
    try {
        const request = context.request;
        const total = COUNTS['${type}'];

        if (!total || total < 1) {
            return jsonResponse({ error: 'No images for type ${type}' }, 404);
        }

        const idx = Math.floor(Math.random() * total) + 1;
        const host = (request && request.headers && request.headers.get('host')) || 'pic.olinl.com';
        const proto = (request && request.headers && request.headers.get('x-forwarded-proto')) || 'https';
        const target = proto + '://' + host + '/ri/${type}/' + idx + '.webp';

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
`;
    }

    // 调试端点：返回注入的 COUNTS，方便排查
    const statusTemplate = `/**
 * 调试端点 /api/status（构建时由 build.js 生成）
 */
const COUNTS = ${JSON.stringify(counts)};
const BUILD_TIME = ${JSON.stringify(new Date().toISOString())};

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
`;

    // 写出 /random/h, /random/v 各自一个文件（不用通配）
    function writeRandomFn(folder, type) {
        const content = makeRandomFn(type);
        const dir = path.join(ROOT, folder, 'random');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, type + '.js'), content);
        const dstDir = path.join(DIST, folder, 'random');
        fs.mkdirSync(dstDir, { recursive: true });
        fs.writeFileSync(path.join(dstDir, type + '.js'), content);
        console.log(`Wrote ${folder}/random/${type}.js (COUNTS baked, no [type])`);
    }

    // 清理可能还存在的 [type].js 旧文件，避免被意外匹配
    for (const folder of ['functions', 'edge-functions']) {
        const oldPath = path.join(ROOT, folder, 'random', '[type].js');
        if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
            console.log(`Removed legacy ${folder}/random/[type].js`);
        }
        const oldDist = path.join(DIST, folder, 'random', '[type].js');
        if (fs.existsSync(oldDist)) {
            fs.unlinkSync(oldDist);
            console.log(`Removed legacy dist/${folder}/random/[type].js`);
        }
    }

    function writeStatus(folder) {
        const dir = path.join(ROOT, folder, 'api', 'status');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.js'), statusTemplate);
        const dstDir = path.join(DIST, folder, 'api', 'status');
        fs.mkdirSync(dstDir, { recursive: true });
        fs.writeFileSync(path.join(dstDir, 'index.js'), statusTemplate);
        console.log(`Wrote ${folder}/api/status/index.js`);
    }

    for (const folder of ['functions', 'edge-functions']) {
        writeRandomFn(folder, 'h');
        writeRandomFn(folder, 'v');
        writeStatus(folder);
    }

    // 3. Generate Single JS
    const jsContent = `
/**
 * Static Random Pic API
 * 由构建脚本生成
 */
(function() {
    var counts = ${JSON.stringify(counts)};
    var domain = '${config.domain}';
    
    // ==================== 状态管理 ====================
    
    // 背景禁用状态（从 localStorage 读取）
    var backgroundDisabled = localStorage.getItem('theme-bg-disabled') === 'true';
    
    // 记住首次加载的背景 URL（用于保持会话一致性）
    var currentBackgroundUrl = null;
    
    // 会话随机 URL 缓存
    var sessionRandomH = null;
    var sessionRandomV = null;

    // ==================== 辅助函数 ====================
    
    // 检测设备类型（移动端 vs 桌面端）
    function getDeviceType() {
        var userAgent = navigator.userAgent || navigator.vendor || window.opera;
        if (/android|ipad|iphone|ipod|windows phone|iemobile|blackberry|mobile/i.test(userAgent)) {
            return 'mobile';
        }
        return 'desktop';
    }

    // 获取指定类型（h 或 v）的随机 URL，同一会话内保持一致
    function getRandomUrl(type) {
        if (!counts[type] || counts[type] === 0) return '';
        
        // 如果存在会话 URL 则返回
        if (type === 'h' && sessionRandomH) return sessionRandomH;
        if (type === 'v' && sessionRandomV) return sessionRandomV;

        // 如果不存在则生成新的
        var num = Math.floor(Math.random() * counts[type]) + 1;
        var url = domain + '/ri/' + type + '/' + num + '.webp';

        // 保存到会话状态
        if (type === 'h') sessionRandomH = url;
        if (type === 'v') sessionRandomV = url;

        return url;
    }

    // 根据设备类型获取随机 URL
    function getRandomUrlByDevice() {
        var deviceType = getDeviceType();
        var type = deviceType === 'mobile' ? 'v' : 'h';
        return getRandomUrl(type);
    }

    // ==================== 全局函数暴露 ====================
    
    window.getRandomPicH = function() { return getRandomUrl('h'); };
    window.getRandomPicV = function() { return getRandomUrl('v'); };
    window.getRandomPic = function() { return getRandomUrlByDevice(); };

    // ==================== 背景设置逻辑 ====================
    
    function setRandomBackground() {
        // 如果禁用，清除背景并退出
        if (backgroundDisabled) {
            const bgBox = document.getElementById('bg-box');
            if (bgBox) {
                bgBox.style.backgroundImage = 'none';
                bgBox.classList.remove('loaded');
            }
            if (document.body.classList.contains('wp-theme-zibll')) {
                document.body.style.backgroundImage = 'none';
                document.body.classList.remove('loaded');
            }
            console.log('[RandomPic] 背景已禁用');
            return;
        }
        
        // 优先使用已缓存的 currentBackgroundUrl
        let bgUrl = currentBackgroundUrl;
        if (!bgUrl) {
            bgUrl = getRandomUrlByDevice();
            currentBackgroundUrl = bgUrl; // 首次加载时缓存
        }
        
        // 查找背景框元素
        const bgBox = document.getElementById('bg-box'); 
          
        if (bgBox) { 
            // 方案1：使用 #bg-box 元素
            const img = new Image(); 
            img.onload = function() { 
                bgBox.style.backgroundImage = \`url('\${bgUrl}')\`; 
                bgBox.classList.add('loaded'); 
                console.log('随机背景已加载:', bgUrl); 
                
                // 设置 CSS 变量以实现透明效果
                document.documentElement.style.setProperty('--card-bg', 'var(--card-bg-transparent)'); 
                document.documentElement.style.setProperty('--float-panel-bg', 'var(--float-panel-bg-transparent)'); 
            }; 
            img.onerror = function() { 
                console.error('背景图片加载失败:', bgUrl); 
            }; 
            img.src = bgUrl; 
        } else if (document.body.classList.contains('wp-theme-zibll')) {
            // 方案2：wp-theme-zibll 主题，设置 body 的背景
            const img = new Image(); 
            img.onload = function() { 
                document.body.style.backgroundImage = \`url('\${bgUrl}')\`; 
                document.body.style.backgroundPosition = 'center top';
                document.body.style.backgroundRepeat = 'no-repeat';
                document.body.style.backgroundAttachment = 'fixed';
                document.body.style.backgroundSize = 'cover';
                document.body.classList.add('loaded'); 
                console.log('随机背景已加载到 body (wp-theme-zibll):', bgUrl); 
            }; 
            img.onerror = function() { 
                console.error('body 背景图片加载失败 (wp-theme-zibll):', bgUrl); 
            }; 
            img.src = bgUrl; 
        } else { 
            // 方案3：回退方案，检查 data-random-bg 属性
            initGenericBackgrounds();
        } 
    }

    // ==================== 图片标签处理 ====================
    
    function initImgTags() {
        var imgTags = document.getElementsByTagName('img');
        for (var i = 0; i < imgTags.length; i++) {
            var img = imgTags[i];
            var alt = img.getAttribute('alt');
            var src = img.getAttribute('src');

            if (alt === 'random:h' || (src && src.indexOf('/random/h') !== -1)) {
                img.src = getRandomUrl('h');
            } else if (alt === 'random:v' || (src && src.indexOf('/random/v') !== -1)) {
                img.src = getRandomUrl('v');
            }
        }
    }

    // 通用 data-random-bg 的辅助函数（作为备用或次要功能）
    function initGenericBackgrounds() {
        var bgElements = document.querySelectorAll('[data-random-bg]');
        bgElements.forEach(function(el) {
            // 跳过 bg-box（虽然 setRandomBackground 已经专门处理了 #bg-box）
            if (el.id === 'bg-box') return;

            var type = el.getAttribute('data-random-bg');
            if (type === 'h' || type === 'v') {
                var url = getRandomUrl(type);
                if (url) {
                    var img = new Image();
                    img.onload = function() {
                        el.style.backgroundImage = 'url("' + url + '")';
                        el.classList.add('loaded');
                    };
                    img.src = url;
                }
            }
        });
    }

    // ==================== 初始化逻辑 ====================
    
    function init() {
        setRandomBackground();
        initImgTags();
    }
  
    // 初始加载时运行
    if (document.readyState === 'loading') { 
        document.addEventListener('DOMContentLoaded', init); 
    } else { 
        init(); 
    } 
  
    // ==================== Swup 集成 ====================
    
    function setupSwup() {
        if (window.swup && window.swup.hooks) {
            // 注册内容替换钩子
            window.swup.hooks.on('content:replace', init);
            console.log('Random Pic API: 已注册到 Swup 钩子。');
        }
    }

    if (window.swup) {
        setupSwup();
    } else {
        document.addEventListener('swup:enable', setupSwup);
    }

    // 旧版 Swup 支持
    document.addEventListener('swup:contentReplaced', init); 
    
    // ==================== 全局控制接口 ====================
    
    // 设置背景禁用状态
    window.setBackgroundDisabled = function(disabled) {
        backgroundDisabled = Boolean(disabled);
        localStorage.setItem('theme-bg-disabled', backgroundDisabled);
        setRandomBackground(); // 重新应用
    };
    
    // 更换壁纸接口
    window.refreshRandomBackground = function() {
        // 强制清除所有缓存
        sessionRandomH = null;
        sessionRandomV = null;
        currentBackgroundUrl = null;
    
        // 如果背景未被禁用，则立即加载新图
        if (!backgroundDisabled) {
            setRandomBackground();
            console.log('[RandomPic] 壁纸已更换');
        } else {
            console.log('[RandomPic] 壁纸已预生成，但背景处于禁用状态');
        }
    };
    
})();
`;
    fs.writeFileSync(path.join(DIST, 'random.js'), jsContent.trim());

    // Copy index.html if exists and not empty
    const indexSrc = path.join(ROOT, 'index.html');
    if (fs.existsSync(indexSrc)) {
         const stats = fs.statSync(indexSrc);
         if (stats.size > 0) {
             fs.copyFileSync(indexSrc, path.join(DIST, 'index.html'));
             console.log('Copied index.html to dist');
         } else {
             console.log('index.html is empty, creating a demo page in dist...');
             createDemoHtml();
         }
    } else {
        createDemoHtml();
    }

    // 4. Generate Gallery Page
    createGalleryHtml(counts, config);
    
    console.log('Build complete. Output is in /dist folder.');
}

function createGalleryHtml(counts, config) {
    const domain = config.domain;
    const types = Object.keys(counts);

    // 1. Prepare Libs in dist/lib
    const libDir = path.join(DIST, 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    
    try {
        // Try to copy from node_modules if they exist
        const masonrySrc = path.join(ROOT, 'node_modules', 'masonry-layout', 'dist', 'masonry.pkgd.min.js');
        const imagesLoadedSrc = path.join(ROOT, 'node_modules', 'imagesloaded', 'imagesloaded.pkgd.min.js');
        const lozadSrc = path.join(ROOT, 'node_modules', 'lozad', 'dist', 'lozad.min.js');
        
        if (fs.existsSync(masonrySrc)) fs.copyFileSync(masonrySrc, path.join(libDir, 'masonry.pkgd.min.js'));
        if (fs.existsSync(imagesLoadedSrc)) fs.copyFileSync(imagesLoadedSrc, path.join(libDir, 'imagesloaded.pkgd.min.js'));
        if (fs.existsSync(lozadSrc)) fs.copyFileSync(lozadSrc, path.join(libDir, 'lozad.min.js'));
    } catch (e) {
        console.warn('Could not copy libraries. Ensure npm install is run.', e);
    }

    let galleryContent = '';

    // 2. Generate Sections per Type
    let navButtons = `<button class="filter-btn active" onclick="filterGallery('all')">All</button>`;
    
    types.forEach(type => {
        const count = counts[type];
        if (count === 0) return;

        navButtons += `<button class="filter-btn" onclick="filterGallery('${type}')">${type.toUpperCase()}</button>`;

        let itemsHtml = '';
        for (let i = 1; i <= count; i++) {
             const url = domain ? `${domain}/ri/${type}/${i}.webp` : `./ri/${type}/${i}.webp`;
             // Use data-src for lozad, add class 'lozad'
             itemsHtml += `<div class="grid-item"><img class="lozad" data-src="${url}" alt="${type}-${i}"></div>\n`;
        }

        galleryContent += `
        <section id="section-${type}" class="gallery-section">
            <h2>Folder: ${type}</h2>
            <div class="grid" id="grid-${type}">
                <div class="grid-sizer"></div>
                ${itemsHtml}
            </div>
        </section>
        `;
    });

    const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gallery - Static Random Pic API</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f0f2f5;
        }
        h1 { text-align: center; color: #333; margin-bottom: 20px; }
        
        /* Filter Nav */
        .filter-nav { text-align: center; margin-bottom: 30px; }
        .filter-btn {
            background: #fff; border: 1px solid #ddd; padding: 8px 16px; margin: 0 5px;
            border-radius: 20px; cursor: pointer; transition: all 0.2s; font-size: 14px;
            color: #555;
        }
        .filter-btn:hover { background: #f8f9fa; border-color: #ccc; }
        .filter-btn.active { background: #007bff; color: white; border-color: #007bff; }

        h2 { border-bottom: 2px solid #ddd; padding-bottom: 10px; margin-top: 40px; color: #555; text-transform: uppercase; font-size: 1.2rem; }
        
        /* Masonry Grid */
        .grid {
            margin: 0 auto;
        }
        .grid-sizer, .grid-item {
            width: 23%; /* 4 columns by default */
            margin-bottom: 10px;
        }
        .grid-item {
            float: left;
            background: #fff;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            min-height: 150px; /* Initial loading height */
            background-color: #eee;
            transition: background-color 0.3s;
        }
        /* When loaded, remove min-height constraint so it fits content exactly */
        .grid-item.content-loaded {
            min-height: 0;
            background-color: #fff;
        }
        
        .grid-item img {
            display: block;
            width: 100%;
            height: auto;
            opacity: 0;
            transition: opacity 0.4s;
        }
        /* Fade in when loaded */
        .grid-item img[data-loaded="true"] {
            opacity: 1;
        }

        /* Responsive */
        @media (max-width: 1200px) {
            .grid-sizer, .grid-item { width: 31%; }
        }
        @media (max-width: 800px) {
            .grid-sizer, .grid-item { width: 48%; }
        }
        @media (max-width: 500px) {
            .grid-sizer, .grid-item { width: 100%; }
        }
    </style>
</head>
<body>
    <h1>Static Image Gallery</h1>
    
    <div class="filter-nav">
        ${navButtons}
    </div>

    ${galleryContent}

    <!-- Libs -->
    <script src="lib/masonry.pkgd.min.js"></script>
    <script src="lib/imagesloaded.pkgd.min.js"></script>
    <script src="lib/lozad.min.js"></script>
    <script>
        var masonryInstances = [];

        document.addEventListener('DOMContentLoaded', function() {
            var grids = document.querySelectorAll('.grid');
            
            // Initialize Masonry first
            grids.forEach(function(grid) {
                var msnry = new Masonry(grid, {
                    itemSelector: '.grid-item',
                    columnWidth: '.grid-sizer',
                    percentPosition: true,
                    gutter: 15
                });
                masonryInstances.push(msnry);
            });

            // Initialize Lozad (Lazy Loading)
            const observer = lozad('.lozad', {
                rootMargin: '200px 0px', // Start loading earlier
                threshold: 0, // Trigger immediately when even 1px is visible (or within margin)
                loaded: function(el) {
                    // Function to handle load complete
                    const onImgLoad = function() {
                        el.setAttribute('data-loaded', true);
                        el.closest('.grid-item').classList.add('content-loaded');
                        // Trigger Masonry layout update
                        masonryInstances.forEach(msnry => msnry.layout());
                    };

                    if (el.complete && el.naturalHeight !== 0) {
                        onImgLoad();
                    } else {
                        el.onload = onImgLoad;
                    }
                }
            });
            observer.observe();

            // Force a layout check after a short delay to ensure Masonry has set up correctly
            setTimeout(() => {
                masonryInstances.forEach(msnry => msnry.layout());
            }, 100);
        });

        function filterGallery(type) {
            // Update buttons
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');

            // Filter sections
            document.querySelectorAll('.gallery-section').forEach(sec => {
                if (type === 'all' || sec.id === 'section-' + type) {
                    sec.style.display = 'block';
                } else {
                    sec.style.display = 'none';
                }
            });
            
            // Trigger Lozad observation on visible elements
            // (Lozad observes viewport, but hiding/showing might affect it)
            // Actually Lozad uses IntersectionObserver so it should handle it.
            
            setTimeout(() => {
                masonryInstances.forEach(msnry => msnry.layout());
            }, 10);
        }
    </script>
</body>
</html>`;

    fs.writeFileSync(path.join(DIST, 'gallery.html'), htmlContent);
    console.log('Created gallery.html in dist');
}

function createDemoHtml() {
    const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Static Random Pic API Demo</title>
    <style>
        body { font-family: sans-serif; max-width: 800px; margin: 20px auto; padding: 20px; }
        .card { border: 1px solid #ccc; padding: 20px; margin-bottom: 20px; border-radius: 8px; }
        img { max-width: 100%; height: auto; border-radius: 4px; display: block; background: #eee; min-height: 200px; }
        .btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; }
        .bg-box { width: 100%; height: 200px; background-size: cover; background-position: center; border-radius: 4px; border: 1px dashed #999; display: flex; align-items: center; justify-content: center; color: white; text-shadow: 0 1px 3px rgba(0,0,0,0.8); font-weight: bold; }
    </style>
</head>
<body>
    <h1>Static Random Pic API (Client-Side)</h1>
    <p>
        This is a static implementation. Images are randomized at build time.
        <a href="https://gallery.acofork.com" class="btn" style="float: right;">View Gallery</a>
    </p>

    <div class="card">
        <h2>Horizontal Image (横屏)</h2>
        <p>Using <code>&lt;img alt="random:h"&gt;</code>:</p>
        <!-- Logic: Script finds alt="random:h" and sets src -->
        <img alt="random:h" title="Random Horizontal Image" />
        <br>
        
        <p>Background Image (<code>data-random-bg="h"</code>):</p>
        <!-- Logic: Script finds data-random-bg="h" and sets style.backgroundImage -->
        <div class="bg-box" data-random-bg="h">
            Background Image
        </div>
    </div>

    <div class="card">
        <h2>Vertical Image (竖屏)</h2>
        <p>Using <code>&lt;img alt="random:v"&gt;</code>:</p>
        <img alt="random:v" style="max-height: 400px;" title="Random Vertical Image" />
    </div>

    <!-- Import the single generated script -->
    <script src="random.js"></script>
</body>
</html>`;
    fs.writeFileSync(path.join(DIST, 'index.html'), htmlContent);
    console.log('Created demo index.html in dist');
}

build();
