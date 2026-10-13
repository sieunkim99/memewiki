const MAX_UPLOAD_FILES = 5;
let uploadItems = [];
let uploadAvailable = false;
let uploadBusy = false;
let uploadAnalyzing = false;
let nextUploadId = 1;

const uploadFields = [
  ['title', '제목', 120, false],
  ['situation', '상황 설명', 1500, true],
  ['emotions_raw', '발신자 감정', 500, false],
  ['intent', '표현 의도', 500, false],
  ['humor_type', '유머 유형', 500, false],
  ['cautions', '주의사항', 1000, true]
];

function uploadStatus(message, error = false) {
  const status = document.getElementById('upload-status');
  status.textContent = message;
  status.dataset.error = String(error);
}

function updateUploadControls() {
  const ready = uploadItems.filter(item => item.status === 'ready').length;
  document.getElementById('upload-analyze').disabled = !uploadAvailable || uploadBusy || uploadAnalyzing ||
    !uploadItems.some(item => ['pending', 'error'].includes(item.status));
  document.getElementById('upload-submit').disabled = uploadBusy || uploadAnalyzing ||
    !ready || ready !== uploadItems.length;
  document.getElementById('upload-submit').textContent = uploadBusy ? '저장 중...' : `확인한 ${ready}개 저장`;
  document.getElementById('upload-file').disabled = uploadBusy || uploadAnalyzing;
  document.getElementById('upload-discard').disabled = uploadBusy || !uploadItems.length;
  document.getElementById('upload-close').disabled = uploadBusy;
  document.getElementById('upload-items').querySelectorAll('input, textarea, select, button').forEach(el => {
    const item = uploadItems.find(row => row.id === Number(el.closest('.upload-item').dataset.id));
    el.disabled = uploadBusy ||
      (el.dataset.action === 'retry' && uploadAnalyzing);
  });
  document.querySelector('.upload-dialog').setAttribute('aria-busy', String(uploadBusy || uploadAnalyzing));
}

function closeUpload() {
  if (uploadBusy) return;
  document.getElementById('upload-modal').style.display = 'none';
  document.body.style.overflow = '';
  document.getElementById('btn-add-meme').focus();
}

async function discardServerDraft(token) {
  if (!token) return;
  try {
    await fetch(API_BASE + '/api/upload-drafts/' + encodeURIComponent(token), { method: 'DELETE' });
  } catch (error) { console.warn('Draft cleanup failed; it will expire automatically.'); }
}

function removeUpload(id) {
  if (uploadBusy) return;
  const item = uploadItems.find(row => row.id === id);
  if (!item) return;
  uploadItems = uploadItems.filter(row => row.id !== id);
  URL.revokeObjectURL(item.url);
  discardServerDraft(item.token);
  document.querySelector(`.upload-item[data-id="${id}"]`)?.remove();
  updateUploadControls();
  uploadStatus(`선택 ${uploadItems.length}/${MAX_UPLOAD_FILES}장`);
  document.getElementById('upload-file').focus();
}

function uploadItemHtml(item) {
  const labels = { pending: '분석 대기', analyzing: 'AI 분석 중...', ready: '분석 내용 편집 · 저장 대기', error: '분석 실패' };
  const analysis = item.analysis;
  const select = (field, label, options) => `<label class="upload-field">${label}
    <select data-field="${field}" required>${options.map(value =>
      `<option value="${escapeHtml(value)}" ${analysis[field] === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>`;
  const editor = analysis ? `<div class="upload-editor">
    ${uploadFields.map(([field, label, maxLength, multiline]) => `<label class="upload-field ${multiline ? 'upload-field-wide' : ''}">${label}
      ${multiline ? `<textarea data-field="${field}" maxlength="${maxLength}" rows="3" ${field === 'situation' ? 'required' : ''}>${escapeHtml(analysis[field])}</textarea>` :
        `<input data-field="${field}" maxlength="${maxLength}" value="${escapeHtml(analysis[field])}" ${field === 'title' ? 'required' : ''}>`}</label>`).join('')}
    ${select('category_emotion', '감정 분류', state.categories.emotions)}
    ${select('category_situation', '상황 분류', state.categories.situations)}
    ${select('tier', '안전 수위', state.categories.tiers)}
    <label class="upload-field">키워드<input data-field="keywords" maxlength="970" required value="${escapeHtml(analysis.keywords.join(', '))}"></label>
    <fieldset class="upload-field-wide upload-examples"><legend>활용 예시</legend>
      ${[0, 1, 2].map(index => `<textarea data-field="examples" data-index="${index}" aria-label="활용 예시 ${index + 1}" maxlength="500" rows="2" ${index === 0 ? 'required' : ''}>${escapeHtml(analysis.examples[index] || '')}</textarea>`).join('')}
    </fieldset>
    <fieldset class="upload-field-wide upload-recipients"><legend>추천 수신인</legend>
      ${state.categories.recipients.map(recipient => `<label><input type="checkbox" data-field="category_recipients" value="${escapeHtml(recipient)}" ${analysis.category_recipients.includes(recipient) ? 'checked' : ''}>${escapeHtml(recipient)}</label>`).join('')}
    </fieldset>
  </div>` : '';
  return `<article class="upload-item" data-id="${item.id}">
    <div class="upload-item-heading"><h3>${escapeHtml(item.file.name)}</h3>
      <button type="button" class="upload-remove" data-action="remove" title="이미지 제외" aria-label="${escapeHtml(item.file.name)} 제외">✕</button>
    </div>
    <p class="upload-item-status" role="status">${item.duplicate ? '기존 이미지 · 수정 내용 저장 대기' : labels[item.status]}</p>
    <div class="upload-item-content"><img class="upload-preview" src="${item.url}" alt="${escapeHtml(item.file.name)}">
      ${editor}</div>
    ${item.error ? `<p class="upload-item-error">${escapeHtml(item.error)}</p><button type="button" class="btn btn-outline btn-sm" data-action="retry">다시 분석</button>` : ''}
  </article>`;
}

function renderUploadItem(item) {
  const container = document.createElement('div');
  container.innerHTML = uploadItemHtml(item);
  const old = document.querySelector(`.upload-item[data-id="${item.id}"]`);
  if (old) old.replaceWith(container.firstElementChild);
  else document.getElementById('upload-items').appendChild(container.firstElementChild);
  updateUploadControls();
}

function selectUploads(files) {
  if (uploadBusy || uploadAnalyzing) return;
  const selected = Array.from(files);
  if (uploadItems.length + selected.length > MAX_UPLOAD_FILES) {
    uploadStatus('이미지는 한 번에 최대 5장까지 선택할 수 있습니다.', true);
    return;
  }
  if (selected.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
    uploadStatus('JPG, PNG, WebP 이미지를 선택해주세요.', true);
    return;
  }
  if (selected.some(file => !file.size || file.size > 10 * 1024 * 1024)) {
    uploadStatus('빈 파일은 등록할 수 없으며, 이미지는 장당 10MB 이하여야 합니다.', true);
    return;
  }
  selected.forEach(file => {
    const item = { id: nextUploadId++, file, url: URL.createObjectURL(file), status: 'pending' };
    uploadItems.push(item);
    renderUploadItem(item);
  });
  uploadStatus(`선택 ${uploadItems.length}/${MAX_UPLOAD_FILES}장`);
  updateUploadControls();
}

async function uploadResponse(response) {
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '입력한 내용을 확인해주세요.');
  return result;
}

async function analyzeUploads(onlyId = null) {
  if (!uploadAvailable || uploadBusy || uploadAnalyzing) return;
  const queue = uploadItems.filter(item => ['pending', 'error'].includes(item.status) && (!onlyId || item.id === onlyId));
  if (!queue.length) return;
  uploadAnalyzing = true;
  updateUploadControls();
  let completed = 0;
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (!uploadItems.includes(item)) continue;
      item.status = 'analyzing';
      item.error = '';
      renderUploadItem(item);
      const form = new FormData();
      form.append('files', item.file);
      try {
        const result = await uploadResponse(await fetch(API_BASE + '/api/uploads/analyze', { method: 'POST', body: form }));
        const draft = result.results[0];
        if (draft.error) throw new Error(draft.error);
        if (!uploadItems.includes(item)) { await discardServerDraft(draft.token); continue; }
        item.token = draft.token;
        item.analysis = draft.analysis;
        item.duplicate = draft.duplicate;
        item.status = 'ready';
      } catch (error) {
        if (!uploadItems.includes(item)) continue;
        item.status = 'error';
        item.error = error.message || '분석에 실패했습니다. 다시 시도해주세요.';
      }
      completed += 1;
      renderUploadItem(item);
      uploadStatus(`분석 완료 ${completed}장 · 저장 전 확인`);
    }
  }
  try {
    await Promise.all([worker(), worker()]);
  } finally {
    uploadAnalyzing = false;
    updateUploadControls();
    const errors = uploadItems.filter(item => item.status === 'error').length;
    uploadStatus(errors ? `${errors}장 분석 실패 · 실패한 이미지를 다시 분석하거나 제외해주세요.` :
      `분석 완료 ${uploadItems.length}장 · 아직 저장되지 않았습니다.`, Boolean(errors));
  }
}

async function saveUploads(event) {
  event.preventDefault();
  if (uploadBusy || uploadAnalyzing || !uploadItems.length || uploadItems.some(item => item.status !== 'ready')) return;
  if (!document.getElementById('upload-form').reportValidity()) return;
  const items = uploadItems.map(item => ({ token: item.token, analysis: {
    ...item.analysis, title: item.analysis.title.trim(), situation: item.analysis.situation.trim(),
    examples: item.analysis.examples.map(value => value.trim()).filter(Boolean)
  }}));
  if (items.some(item => !item.analysis.title || !item.analysis.situation ||
      !item.analysis.examples.length || !item.analysis.category_recipients.length ||
      !item.analysis.keywords.length || item.analysis.keywords.length > 12 ||
      item.analysis.keywords.some(keyword => keyword.length > 80))) {
    uploadStatus('제목·설명·활용 예시·수신인과 키워드(최대 12개, 각 80자)를 확인해주세요.', true);
    return;
  }
  uploadBusy = true;
  updateUploadControls();
  uploadStatus('확인한 내용을 저장하는 중...');
  let saved;
  try {
    saved = await uploadResponse(await fetch(API_BASE + '/api/uploads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items })
    }));
  } catch (error) {
    uploadStatus(error.message || '저장에 실패했습니다. 다시 시도해주세요.', true);
  } finally {
    uploadBusy = false;
    updateUploadControls();
  }
  if (!saved) return;
  // A refresh error must not turn a successful commit into a failed save.
  if (state.rawDb) {
    const documents = [...new Map(saved.results.map(result => [result.meme.id, result.meme])).values()];
    const ids = new Set(documents.map(meme => meme.id));
    state.rawDb.memes = [...documents, ...state.rawDb.memes.filter(meme => !ids.has(meme.id))];
  }
  uploadItems.forEach(item => URL.revokeObjectURL(item.url));
  uploadItems = [];
  document.getElementById('upload-items').replaceChildren();
  updateUploadControls();
  closeUpload();
  try {
    const response = await fetch(API_BASE + '/api/database', { cache: 'no-store' });
    if (response.ok) { state.rawDb = await response.json(); state.apiDatabase = true; }
  } catch (error) { console.warn('Database refresh failed'); }
  state.isStaticMode = true;
  await loadCategories();
  await loadStats();
  state.isAiMode = false;
  DOM.aiBanner.style.display = 'none';
  switchTab('browse');
  resetFilters();
  const messages = [];
  if (saved.saved_count) messages.push(`${saved.saved_count}개 새로 저장`);
  if (saved.updated_count) messages.push(`${saved.updated_count}개 수정 완료`);
  const unchanged = saved.results.filter(result => result.duplicate && !result.updated).length;
  if (unchanged) messages.push(`${unchanged}개 변경 없음`);
  showToast(messages.join(' · '));
  if (saved.results.length === 1) await openModal(saved.results[0].meme.id);
}

function setupUpload() {
  const modal = document.getElementById('upload-modal');
  const input = document.getElementById('upload-file');
  document.getElementById('btn-add-meme').addEventListener('click', async () => {
    closeModal();
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.getElementById('upload-close').focus();
    if (uploadAnalyzing || uploadBusy) return;
    uploadAvailable = false;
    updateUploadControls();
    try {
      if (document.documentElement.dataset.static === 'true' && !API_BASE) throw new Error('이미지 분석 서버가 아직 연결되지 않았습니다.');
      const status = await uploadResponse(await fetch(API_BASE + '/api/upload-status'));
      uploadAvailable = status.enabled;
      uploadStatus(status.enabled ? (uploadItems.length ? `선택 ${uploadItems.length}/5장` : '이미지를 선택해주세요.') : '서버의 AI API 키를 설정해주세요.', !status.enabled);
    } catch (error) { uploadStatus(error.message, true); }
    updateUploadControls();
  });
  document.getElementById('upload-close').addEventListener('click', closeUpload);
  modal.addEventListener('click', event => { if (event.target === modal) closeUpload(); });
  modal.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  input.addEventListener('change', () => { selectUploads(input.files); input.value = ''; });
  const dropzone = document.getElementById('upload-dropzone');
  ['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => {
    event.preventDefault(); dropzone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => {
    event.preventDefault(); dropzone.classList.remove('dragging');
    if (type === 'drop') selectUploads(event.dataTransfer.files);
  }));
  const list = document.getElementById('upload-items');
  list.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = Number(button.closest('.upload-item').dataset.id);
    if (button.dataset.action === 'remove') removeUpload(id);
    else analyzeUploads(id);
  });
  list.addEventListener('input', event => {
    const field = event.target.dataset.field;
    if (!field) return;
    const item = uploadItems.find(row => row.id === Number(event.target.closest('.upload-item').dataset.id));
    if (field === 'examples') item.analysis.examples[Number(event.target.dataset.index)] = event.target.value;
    else if (field === 'keywords') item.analysis.keywords = event.target.value.split(/[,\n]/).map(value => value.trim()).filter(Boolean);
    else if (field === 'category_recipients') item.analysis.category_recipients =
      [...event.target.closest('fieldset').querySelectorAll('input:checked')].map(checkbox => checkbox.value);
    else item.analysis[field] = event.target.value;
  });
  document.getElementById('upload-analyze').addEventListener('click', () => analyzeUploads());
  document.getElementById('upload-discard').addEventListener('click', () => {
    if (uploadBusy) return;
    [...uploadItems].forEach(item => removeUpload(item.id));
  });
  document.getElementById('upload-form').addEventListener('submit', saveUploads);
}
