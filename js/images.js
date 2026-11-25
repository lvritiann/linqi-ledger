/* 图片上传：多选、粘贴、拖拽、自动压缩为 JPEG dataURL */
(function (global) {
  'use strict';
  const U = global.LQUtils;
  const MAX_EDGE = 1400;
  const QUALITY = 0.82;

  function compress(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片解码失败：' + file.name));
        img.onload = () => {
          let w = img.width, h = img.height;
          const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', QUALITY));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(groupName, files) {
    const block = U.$(`.upload-block[data-group="${groupName}"]`);
    if (!block) return;
    const list = global.LQApp.getImages(groupName);
    const imageFiles = Array.from(files).filter(f => /^image\//.test(f.type));
    if (!imageFiles.length) { U.toast('请选择图片文件', true); return; }
    for (const f of imageFiles) {
      try {
        const data = await compress(f);
        list.push({ name: f.name || 'paste.jpg', data });
      } catch (e) { U.toast(e.message, true); }
    }
    global.LQApp.setImages(groupName, list);
    global.LQApp.renderImages(groupName);
    U.toast(`已添加 ${imageFiles.length} 张图片（自动压缩）`);
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
