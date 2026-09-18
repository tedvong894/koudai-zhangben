// 口袋账本 PWA：注册 Service Worker，提供「安装到本地」能力
(function () {
  'use strict';
  var deferredPrompt = null;

  // 注册 Service Worker（支持离线打开）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function (reg) {
        // 检测到新版本 → 自动刷新加载新外壳（免手动杀进程）
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', function () {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              location.reload();
            }
          });
        });
        // 注册时若发现已在等待的新版本，也刷新
        if (reg.waiting && navigator.serviceWorker.controller) location.reload();
      }).catch(function (err) {
        console.warn('SW 注册失败（不影响使用）：', err);
      });
    });
  }

  // 捕获浏览器原生「可安装」事件
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    // 显示安装入口
    var btn = document.getElementById('install-app');
    var tip = document.getElementById('install-tip');
    if (btn) btn.style.display = '';
    if (tip) tip.style.display = '';
  });

  // 已安装后隐藏入口
  window.addEventListener('appinstalled', function () {
    var btn = document.getElementById('install-app');
    var tip = document.getElementById('install-tip');
    if (btn) btn.style.display = 'none';
    if (tip) tip.style.display = 'none';
  });

  // 暴露安装触发函数，供「我的」页按钮调用
  window.installApp = function () {
    // 已经在独立窗口（已安装）则无需再装
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      alert('已在本地运行。\n安卓/电脑：可从菜单「卸载」移除；iPhone：长按主屏图标删除。');
      return;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
      });
      return;
    }
    // 不支持原生弹窗时，给出对应浏览器的手动安装指引
    var ua = navigator.userAgent || '';
    var guide;
    if (/iPhone|iPad|iPod/i.test(ua)) {
      guide = 'iPhone/iPad：点击底部工具栏的「分享」按钮（方框带向上箭头），选择「添加到主屏幕」，即可安装到桌面。';
    } else if (/Android/i.test(ua)) {
      guide = 'Android Chrome：点击右上角 ⋮ 菜单 →「安装应用 / 添加到主屏幕」。';
    } else if (/Chrome|Edge/i.test(ua)) {
      guide = '电脑 Chrome/Edge：地址栏右侧会出现「安装」图标，点它即可；或按 F11 全屏使用。';
    } else {
      guide = '请使用 Chrome / Edge / Safari 打开本页面，通过浏览器的「安装 / 添加到主屏幕」功能安装。';
    }
    alert('未触发自动安装弹窗。\n' + guide);
  };
})();
