/* 图片上传：多选、粘贴、拖拽、迭代压缩为 ≤200KB 的 JPEG dataURL */
(function (global) {
  'use strict';
  const U = global.LQUtils;

  /* ===== 压缩参数集中在此，便于回归测试时调整 ===== */
  const INITIAL_MAX_EDGE = 1400;              // 初始最长边上限（沿用原值）
  const MIN_EDGE = 640;                       // 最小可接受最长边：再小文字截图会糊
  const EDGE_SHRINK = 0.8;                    // 质量到底后画布等比缩小系数
  const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.4, 0.3]; // 质量档位，从高到低
  const MAX_ITERATIONS = 18;                  // 最大压缩次数（3 档尺寸 × 6 档质量）
  const DEFAULT_TARGET_KB = 200;

  /**
   * 估算 dataURL 解码后的字节数：去掉 data:image/jpeg;base64, 前缀后按 ×3/4 计算。
   * 这里不用 canvas.toBlob：toBlob 是异步回调 API，会打断同步迭代循环、增加状态管理复杂度；
   * 且 base64 长度 ×3/4 是解码体积的保守上界（含 padding 时略偏大），用于达标判断足够可靠。
   */
  function dataURLBytes(dataURL) {
    const comma = dataURL.indexOf(',');
    const base64 = comma >= 0 ? dataURL.slice(comma + 1) : dataURL;
    return Math.floor(base64.length * 3 / 4);
  }

  /**
   * 迭代压缩核心。
   * 策略：同一尺寸下先逐级降质量；质量降到下限时才等比缩小画布，并重新从高质量开始循环。
   *      这样文字截图优先保住分辨率，只有体积确实压不住时才牺牲像素。
   * 终止条件：① 体积达标；② 质量到底且尺寸到底；③ 达到 MAX_ITERATIONS。
   *      三重条件保证循环必定退出，不会死循环。
   * 兜底：若极端图片始终压不到目标，返回历史上体积最小的一次，由 addFiles 明确提示用户。
   */
  function compressCore(img, targetBytes) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const rawEdge = Math.max(img.width, img.height);
    if (!rawEdge) throw new Error('图片尺寸无效');

    let maxEdge = Math.min(INITIAL_MAX_EDGE, rawEdge);
    let qi = 0;
    let iter = 0;
    let best = null;   // 体积最小的一次，作为「尽力压缩」结果

    while (iter < MAX_ITERATIONS) {
      const scale = maxEdge / rawEdge;
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = '#ffffff';              // 透明区域铺白底，JPEG 不出现黑块
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const quality = QUALITY_STEPS[qi];
      const dataURL = canvas.toDataURL('image/jpeg', quality);
      const bytes = dataURLBytes(dataURL);
      iter++;

      if (!best || bytes < best.bytes) {
        best = { dataURL, bytes, width: w, height: h, quality, iterations: iter };
      }
      if (bytes <= targetBytes) {
        return { dataURL, bytes, ok: true, width: w, height: h, quality, iterations: iter };
      }

      if (qi < QUALITY_STEPS.length - 1) {
        qi++;                                 // 当前尺寸还有质量档位可降
      } else if (maxEdge > MIN_EDGE) {
        maxEdge = Math.max(MIN_EDGE, Math.round(maxEdge * EDGE_SHRINK));
        qi = 0;                               // 新尺寸重新从高质量开始，尽量保住清晰度
      } else {
        break;                                // 质量与尺寸均已到底，停止
      }
    }
    return Object.assign({}, best, { ok: best.bytes <= targetBytes });
  }

  /** 返回压缩详情（含体积、是否达标）；对外 compress 只取 dataURL，契约不变。 */
  function compressInfo(file, targetKB) {
    const kb = Number(targetKB) > 0 ? Number(targetKB) : DEFAULT_TARGET_KB;
    const targetBytes = kb * 1024;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片解码失败：' + file.name));
        img.onload = () => {
          try {
            resolve(compressCore(img, targetBytes));
          } catch (e) {
            reject(new Error('图片压缩失败：' + (e && e.message ? e.message : file.name)));
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /** 对外 API 保持不变：compress(file[, targetKB]) → dataURL promise */
  function compress(file, targetKB) {
    return compressInfo(file, targetKB).then(r => r.dataURL);
  }

  async function addFiles(groupName, files) {
    const block = U.$(`.upload-block[data-group="${groupName}"]`);
    if (!block) return;
    const list = global.LQApp.getImages(groupName);
    const imageFiles = Array.from(files).filter(f => /^image\//.test(f.type));
    if (!imageFiles.length) { U.toast('请选择图片文件', true); return; }

    let added = 0, failed = 0, totalBytes = 0;
    const oversized = [];    // 已尽力压缩但仍超过目标的图片
    for (let i = 0; i < imageFiles.length; i++) {
      const f = imageFiles[i];
      try {
        const r = await compressInfo(f, DEFAULT_TARGET_KB);
        list.push({ name: f.name || 'paste.jpg', data: r.dataURL });
        added++;
        totalBytes += r.bytes;
        if (!r.ok) {
          oversized.push({ no: i + 1, kb: Math.round(r.bytes / 1024) });
        }
      } catch (e) {
        failed++;
      }
    }
    if (added) {
      global.LQApp.setImages(groupName, list);
      global.LQApp.renderImages(groupName);
    }

    if (!added) {
      U.toast(`${imageFiles.length} 张图片处理失败，请重试`, true);
      return;
    }
    const totalKB = Math.round(totalBytes / 1024);
    let msg = `已添加 ${added} 张图片（${oversized.length ? '' : `单张≤${DEFAULT_TARGET_KB}KB，`}共 ${totalKB}KB）`;
    if (oversized.length) {
      const detail = oversized.slice(0, 3).map(o => `第 ${o.no} 张约 ${o.kb}KB`).join('、');
      msg += `；其中 ${oversized.length} 张已尽力压缩仍超标（${detail}${oversized.length > 3 ? ' 等' : ''}），建议裁剪后重传`;
    }
    if (failed) msg += `；另有 ${failed} 张失败`;
    U.toast(msg, !!(oversized.length || failed));
  }

  function init() {
    U.$$('.upload-block').forEach(block => {
      const group = block.dataset.group;
      const title = block.dataset.title || '佐证图片';

      const titleEl = document.createElement('div');
      titleEl.className = 'upload-title';
      titleEl.innerHTML = `<span>${U.escapeHtml(title)}</span><span class="cnt" data-cnt="${group}">0 张</span><span style="font-size:11px;color:#9aa1ad">（点击选择 / 拖拽 / Ctrl+V 粘贴）</span>`;
      block.appendChild(titleEl);

      const drop = document.createElement('div');
      drop.className = 'dropzone';
      drop.textContent = '＋ 点击选择图片，或将截图拖到这里';
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
      input.style.display = 'none';
      drop.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        addFiles(group, input.files);
        input.value = '';
      });
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
      drop.addEventListener('drop', e => {
        e.preventDefault(); drop.classList.remove('dragover');
        addFiles(group, e.dataTransfer.files);
      });
      block.appendChild(drop);
      block.appendChild(input);

      const row = document.createElement('div');
      row.className = 'thumb-row';
      row.dataset.row = group;
      block.appendChild(row);

      row.addEventListener('click', e => {
        if (e.target.classList.contains('del')) {
          const i = parseInt(e.target.dataset.i, 10);
          const list = global.LQApp.getImages(group);
          list.splice(i, 1);
          global.LQApp.setImages(group, list);
          global.LQApp.renderImages(group);
        } else if (e.target.tagName === 'IMG') {
          U.lightbox(e.target.src);
        }
      });
    });

    document.addEventListener('paste', e => {
      const panel = U.$('#panel-form');
      if (!panel || !panel.classList.contains('active')) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const files = [];
      for (const it of items) {
        if (it.kind === 'file' && /^image\//.test(it.type)) {
          const f = it.getAsFile();
          if (f) { f.name = f.name || 'paste-' + Date.now() + '.png'; files.push(f); }
        }
      }
      if (!files.length) return;
      e.preventDefault();
      const activeGroup = global.LQApp.activeImageGroup();
      addFiles(activeGroup, files);
    });
  }

  global.LQImages = { init, addFiles, compress };
})(window);
