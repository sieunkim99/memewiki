/**
 * Meme LLM Wiki - Frontend Application Logic
 * Supports both FastAPI Backend API and Standalone Static Mode (GitHub Pages / Serverless)
 */

// Application State
const state = {
  currentTab: 'browse',
  page: 1,
  limit: 24,
  totalPages: 1,
  totalMemes: 0,
  memes: [],
  filters: {
    q: '',
    emotion: '전체',
    situation: '전체',
    recipient: '전체',
    tier: '전체',
    source: '전체',
    sort: 'default'
  },
  categories: null,
  stats: null,
  isAiMode: false,
  aiQuery: '',
  isStaticMode: document.documentElement.dataset.static === 'true',
  rawDb: null
};

// DOM Elements
const DOM = {
  navTabs: document.querySelectorAll('.nav-tab'),
  brandLogo: document.getElementById('nav-brand-logo'),
  badgeTotal: document.getElementById('badge-total-count'),
  btnRandom: document.getElementById('btn-random-meme'),
  searchForm: document.getElementById('ai-search-form'),
  searchInput: document.getElementById('search-input'),
  btnClearSearch: document.getElementById('btn-clear-search'),
  quickPills: document.querySelectorAll('.quick-pill'),
  selectEmotion: document.getElementById('select-emotion'),
  selectSituation: document.getElementById('select-situation'),
  selectRecipient: document.getElementById('select-recipient'),
  selectTier: document.getElementById('select-tier'),
  selectSource: document.getElementById('select-source'),
  btnResetFilters: document.getElementById('btn-reset-filters'),
  categoryChips: document.getElementById('quick-category-chips'),
  aiBanner: document.getElementById('ai-banner'),
  aiQueryDisplay: document.getElementById('ai-query-display'),
  btnExitAi: document.getElementById('btn-exit-ai'),
  memeGrid: document.getElementById('meme-grid'),
  loadingSpinner: document.getElementById('loading-spinner'),
  emptyState: document.getElementById('empty-state'),
  btnEmptyReset: document.getElementById('btn-empty-reset'),
  paginationWrapper: document.getElementById('pagination-wrapper'),
  btnLoadMore: document.getElementById('btn-load-more'),
  resultsCount: document.getElementById('results-count'),
  filterPanel: document.getElementById('filter-panel'),
  memeGallery: document.getElementById('meme-gallery'),
  statsSection: document.getElementById('stats-section'),
  modal: document.getElementById('meme-modal'),
  modalClose: document.getElementById('modal-close'),
  modalContent: document.getElementById('modal-content'),
  toast: document.getElementById('toast-message'),
  statTotal: document.getElementById('stat-total'),
  statHuman: document.getElementById('stat-human'),
  statLlm: document.getElementById('stat-llm'),
  chartEmotions: document.getElementById('chart-emotions'),
  chartSituations: document.getElementById('chart-situations'),
};

// Image URL formatter (supports GitHub Pages relative paths)
function formatImageUrl(url) {
  if (!url) return './placeholder.png';
  if (state.isStaticMode || window.location.hostname.includes('github.io')) {
    if (url.startsWith('/images/')) {
      return './images/' + url.slice(8);
    }
  }
  return url;
}

// Check or load static DB fallback
async function loadStaticDbIfNeeded() {
  if (state.rawDb) return state.rawDb;
  const paths = ['./data/memes.json', '/static/data/memes.json', 'data/memes.json'];
  for (const p of paths) {
    try {
      const res = await fetch(p);
      if (res.ok) {
        state.rawDb = await res.json();
        state.isStaticMode = true;
        return state.rawDb;
      }
    } catch (e) {}
  }
  return null;
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadCategories();
  await loadStats();
  await fetchMemes(true);
});

// Event Listeners
function setupEventListeners() {
  // Brand Logo Click -> Reset
  DOM.brandLogo.addEventListener('click', () => {
    switchTab('browse');
    resetFilters();
  });

  // Nav Tabs
  DOM.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchTab(tabName);
    });
  });

  // Random Meme
  DOM.btnRandom.addEventListener('click', async () => {
    try {
      if (!state.isStaticMode) {
        try {
          const res = await fetch('/api/random');
          if (res.ok) {
            const data = await res.json();
            if (data && data.id) {
              openModal(data.id);
              return;
            }
          }
        } catch (e) {}
      }
      const db = await loadStaticDbIfNeeded();
      if (db && db.memes) {
        const choice = db.memes[Math.floor(Math.random() * db.memes.length)];
        openModal(choice.id);
      }
    } catch (e) {
      showToast('랜덤 밈을 가져오는 데 실패했습니다.');
    }
  });

  // Search Form Submit (AI Recommendation)
  DOM.searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = DOM.searchInput.value.trim();
    if (!query) return;
    executeAiRecommendation(query);
  });

  // Search Input live typing
  DOM.searchInput.addEventListener('input', () => {
    DOM.btnClearSearch.style.display = DOM.searchInput.value ? 'block' : 'none';
  });

  DOM.btnClearSearch.addEventListener('click', () => {
    DOM.searchInput.value = '';
    DOM.btnClearSearch.style.display = 'none';
    if (state.isAiMode) {
      exitAiMode();
    } else {
      state.filters.q = '';
      fetchMemes(true);
    }
  });

  // Quick Prompt Pills
  DOM.quickPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const q = pill.dataset.query;
      DOM.searchInput.value = q;
      DOM.btnClearSearch.style.display = 'block';
      executeAiRecommendation(q);
    });
  });

  // Filter Changes
  DOM.selectEmotion.addEventListener('change', (e) => {
    state.filters.emotion = e.target.value;
    updateChipActiveState();
    fetchMemes(true);
  });

  DOM.selectSituation.addEventListener('change', (e) => {
    state.filters.situation = e.target.value;
    fetchMemes(true);
  });

  DOM.selectRecipient.addEventListener('change', (e) => {
    state.filters.recipient = e.target.value;
    fetchMemes(true);
  });

  DOM.selectTier.addEventListener('change', (e) => {
    state.filters.tier = e.target.value;
    fetchMemes(true);
  });

  DOM.selectSource.addEventListener('change', (e) => {
    state.filters.source = e.target.value;
    fetchMemes(true);
  });

  DOM.btnResetFilters.addEventListener('click', resetFilters);
  DOM.btnEmptyReset.addEventListener('click', resetFilters);

  // Load More Button
  DOM.btnLoadMore.addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page += 1;
      fetchMemes(false);
    }
  });

  // AI Mode Exit
  DOM.btnExitAi.addEventListener('click', exitAiMode);

  // Modal Close
  DOM.modalClose.addEventListener('click', closeModal);
  DOM.modal.addEventListener('click', (e) => {
    if (e.target === DOM.modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

// Tab Switching
function switchTab(tabName) {
  state.currentTab = tabName;
  DOM.navTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));

  if (tabName === 'stats') {
    DOM.filterPanel.style.display = 'none';
    DOM.memeGallery.style.display = 'none';
    DOM.statsSection.style.display = 'block';
  } else if (tabName === 'emotions') {
    DOM.filterPanel.style.display = 'block';
    DOM.memeGallery.style.display = 'block';
    DOM.statsSection.style.display = 'none';
    renderCategoryChips('emotions');
  } else if (tabName === 'situations') {
    DOM.filterPanel.style.display = 'block';
    DOM.memeGallery.style.display = 'block';
    DOM.statsSection.style.display = 'none';
    renderCategoryChips('situations');
  } else if (tabName === 'ai-search') {
    DOM.filterPanel.style.display = 'block';
    DOM.memeGallery.style.display = 'block';
    DOM.statsSection.style.display = 'none';
    DOM.searchInput.focus();
  } else {
    // browse
    DOM.filterPanel.style.display = 'block';
    DOM.memeGallery.style.display = 'block';
    DOM.statsSection.style.display = 'none';
    renderCategoryChips('emotions');
  }
}

// Load Categories
async function loadCategories() {
  try {
    let data = null;
    if (!state.isStaticMode) {
      try {
        const res = await fetch('/api/categories');
        if (res.ok) data = await res.json();
      } catch (e) {}
    }
    if (!data) {
      const db = await loadStaticDbIfNeeded();
      if (db) {
        data = {
          categories: db.categories,
          counts: {
            emotions: db.stats.emotions,
            situations: db.stats.situations,
            recipients: db.stats.recipients,
            tiers: db.stats.tiers
          }
        };
      }
    }
    if (!data) return;

    state.categories = data.categories;
    populateSelect(DOM.selectEmotion, data.categories.emotions, data.counts.emotions, '모든 감정');
    populateSelect(DOM.selectSituation, data.categories.situations, data.counts.situations, '모든 상황');
    populateSelect(DOM.selectRecipient, data.categories.recipients, data.counts.recipients, '모든 수신인');
    renderCategoryChips('emotions');
  } catch (e) {
    console.error('Failed to load categories', e);
  }
}

function populateSelect(selectEl, items, counts, defaultLabel) {
  selectEl.innerHTML = `<option value="전체">${defaultLabel} (${items.length})</option>`;
  items.forEach(it => {
    const c = counts && counts[it] !== undefined ? ` (${counts[it]})` : '';
    const opt = document.createElement('option');
    opt.value = it;
    opt.textContent = `${it}${c}`;
    selectEl.appendChild(opt);
  });
}

// Render Quick Category Chips
function renderCategoryChips(type = 'emotions') {
  if (!state.categories) return;
  DOM.categoryChips.innerHTML = '';

  const list = type === 'situations' ? state.categories.situations : state.categories.emotions;
  const currentVal = type === 'situations' ? state.filters.situation : state.filters.emotion;

  // "전체" Chip
  const allChip = document.createElement('button');
  allChip.className = `cat-chip ${currentVal === '전체' ? 'active' : ''}`;
  allChip.textContent = '전체 보기';
  allChip.addEventListener('click', () => {
    if (type === 'situations') {
      state.filters.situation = '전체';
      DOM.selectSituation.value = '전체';
    } else {
      state.filters.emotion = '전체';
      DOM.selectEmotion.value = '전체';
    }
    updateChipActiveState();
    fetchMemes(true);
  });
  DOM.categoryChips.appendChild(allChip);

  list.forEach(cat => {
    const chip = document.createElement('button');
    chip.className = `cat-chip ${currentVal === cat ? 'active' : ''}`;
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      if (type === 'situations') {
        state.filters.situation = cat;
        DOM.selectSituation.value = cat;
      } else {
        state.filters.emotion = cat;
        DOM.selectEmotion.value = cat;
      }
      updateChipActiveState();
      fetchMemes(true);
    });
    DOM.categoryChips.appendChild(chip);
  });
}

function updateChipActiveState() {
  const chips = DOM.categoryChips.querySelectorAll('.cat-chip');
  chips.forEach(c => {
    const isAll = c.textContent === '전체 보기';
    const isMatch = isAll 
      ? (state.filters.emotion === '전체' && state.filters.situation === '전체')
      : (c.textContent === state.filters.emotion || c.textContent === state.filters.situation);
    c.classList.toggle('active', isMatch);
  });
}

// Fetch Memes (Supports both API & Static Client-side search)
async function fetchMemes(reset = false) {
  if (state.isAiMode) return;

  if (reset) {
    state.page = 1;
    DOM.memeGrid.innerHTML = '';
  }

  DOM.loadingSpinner.style.display = 'block';
  DOM.emptyState.style.display = 'none';

  try {
    let data = null;
    if (!state.isStaticMode) {
      try {
        const params = new URLSearchParams({
          page: state.page,
          limit: state.limit,
          q: state.filters.q,
          emotion: state.filters.emotion,
          situation: state.filters.situation,
          recipient: state.filters.recipient,
          tier: state.filters.tier,
          source: state.filters.source,
          sort: state.filters.sort
        });
        const res = await fetch(`/api/memes?${params.toString()}`);
        if (res.ok) data = await res.json();
      } catch (e) {}
    }

    // Static mode fallback
    if (!data) {
      const db = await loadStaticDbIfNeeded();
      if (db) {
        let filtered = [...db.memes];
        if (state.filters.emotion !== '전체') filtered = filtered.filter(m => m.category_emotion === state.filters.emotion);
        if (state.filters.situation !== '전체') filtered = filtered.filter(m => m.category_situation === state.filters.situation);
        if (state.filters.recipient !== '전체') filtered = filtered.filter(m => m.category_recipients.includes(state.filters.recipient));
        if (state.filters.tier !== '전체') filtered = filtered.filter(m => m.tier === state.filters.tier);
        if (state.filters.source !== '전체') filtered = filtered.filter(m => m.source_type === state.filters.source);

        if (state.filters.q && state.filters.q.trim()) {
          const qLow = state.filters.q.trim().toLowerCase();
          const tokens = qLow.split(/\s+/);
          filtered = filtered.filter(m => {
            const text = `${m.title} ${m.situation} ${(m.examples||[]).join(' ')} ${(m.keywords||[]).join(' ')} ${m.intent}`.toLowerCase();
            return tokens.some(t => text.includes(t));
          });
        }

        const total = filtered.length;
        const start = (state.page - 1) * state.limit;
        const paged = filtered.slice(start, start + state.limit);
        data = {
          total: total,
          page: state.page,
          limit: state.limit,
          total_pages: Math.ceil(total / state.limit),
          memes: paged
        };
      }
    }

    if (!data) throw new Error('No data');

    state.totalPages = data.total_pages;
    state.totalMemes = data.total;
    DOM.resultsCount.textContent = `${data.total}건 검색됨`;

    if (reset) {
      state.memes = data.memes;
    } else {
      state.memes = [...state.memes, ...data.memes];
    }

    renderMemeCards(data.memes, reset);
    DOM.emptyState.style.display = data.total === 0 ? 'block' : 'none';
    DOM.paginationWrapper.style.display = (state.page < state.totalPages) ? 'block' : 'none';

  } catch (e) {
    console.error('Fetch memes error:', e);
    showToast('데이터를 불러오지 못했습니다.');
  } finally {
    DOM.loadingSpinner.style.display = 'none';
  }
}

// Render Meme Cards
function renderMemeCards(memes, clear = false) {
  if (clear) DOM.memeGrid.innerHTML = '';

  memes.forEach(m => {
    const card = document.createElement('div');
    card.className = 'meme-card';
    card.id = `meme-card-${m.idx}`;

    const isLlm = m.source_type === 'llm_collected';
    const imgUrl = formatImageUrl(m.image_url);

    card.innerHTML = `
      <div class="card-img-wrap">
        <div class="card-badges">
          <span class="badge-pill ${isLlm ? 'llm' : ''}">${isLlm ? 'LLM수집' : '인간검수'}</span>
          <span class="badge-pill">${m.tier}</span>
        </div>
        <img class="card-img" src="${imgUrl}" alt="${m.title}" loading="lazy" onerror="this.src='./placeholder.png';">
      </div>
      <div class="card-body">
        <h3 class="card-situation">${escapeHtml(m.situation || m.title)}</h3>
        <div class="card-tags">
          <span class="tag-badge emotion">#${m.category_emotion}</span>
          <span class="tag-badge situation">#${m.category_situation}</span>
        </div>
        <div class="card-footer">
          <span>${escapeHtml(m.id)}</span>
          <span>자세히 보기 →</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => openModal(m.id));
    DOM.memeGrid.appendChild(card);
  });
}

// AI Recommendation Execution (Supports both API & Static Client-side search)
async function executeAiRecommendation(query) {
  state.isAiMode = true;
  state.aiQuery = query;

  DOM.loadingSpinner.style.display = 'block';
  DOM.emptyState.style.display = 'none';
  DOM.paginationWrapper.style.display = 'none';
  DOM.memeGrid.innerHTML = '';

  DOM.aiBanner.style.display = 'flex';
  DOM.aiQueryDisplay.textContent = `"${query}" 상황에 가장 적합한 밈을 분석했습니다.`;

  try {
    let data = null;
    if (!state.isStaticMode) {
      try {
        const res = await fetch('/api/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query, top_k: 12 })
        });
        if (res.ok) data = await res.json();
      } catch (e) {}
    }

    // Static client-side AI recommendation algorithm
    if (!data) {
      const db = await loadStaticDbIfNeeded();
      if (db && db.memes) {
        const qLower = query.toLowerCase();
        const tokens = qLower.split(/[\s,.\?!]+/).filter(t => t.length >= 1);

        const scored = [];
        db.memes.forEach(m => {
          let score = 0;
          const reasons = [];

          (m.keywords || []).forEach(kw => {
            const kwLow = kw.toLowerCase();
            if (kwLow === qLower) {
              score += 15;
              reasons.push(`키워드 '${kw}' 일치`);
            } else if (tokens.some(tok => tok.length >= 2 && kwLow.includes(tok))) {
              score += 10;
              reasons.push(`키워드 '${kw}' 연관`);
            }
          });

          const sitLow = (m.situation || '').toLowerCase();
          const sitMatches = tokens.filter(tok => tok.length >= 2 && sitLow.includes(tok));
          if (sitMatches.length > 0) {
            score += 10 * sitMatches.length;
            reasons.push(`상황 연관: ${sitMatches.slice(0, 2).join(', ')}`);
          }

          (m.examples || []).forEach(ex => {
            const exMatches = tokens.filter(tok => tok.length >= 2 && ex.toLowerCase().includes(tok));
            if (exMatches.length > 0) {
              score += 8;
              reasons.push(`예시 상황 일치: '${ex.slice(0, 20)}...'`);
            }
          });

          (m.category_emotion || '').split('·').forEach(emo => {
            if (qLower.includes(emo)) {
              score += 14;
              reasons.push(`감정 '${emo}' 일치`);
            }
          });

          (m.category_situation || '').split('·').forEach(sit => {
            if (qLower.includes(sit)) {
              score += 14;
              reasons.push(`상황 분류 '${sit}' 일치`);
            }
          });

          if (score > 0) {
            const confidence = Math.min(99, Math.floor(score * 2.2 + 35));
            scored.push({
              meme: m,
              confidence: confidence,
              reason: reasons[0] || '상황 맥락 일치'
            });
          }
        });

        scored.sort((a, b) => b.confidence - a.confidence);
        data = {
          query: query,
          count: Math.min(12, scored.length),
          recommendations: scored.slice(0, 12)
        };
      }
    }

    if (!data) throw new Error('Recommendation failed');

    DOM.resultsCount.textContent = `AI 맞춤 추천 ${data.count}건`;

    if (!data.recommendations || data.recommendations.length === 0) {
      DOM.emptyState.style.display = 'block';
      return;
    }

    data.recommendations.forEach((item, index) => {
      const m = item.meme;
      const card = document.createElement('div');
      card.className = 'meme-card';
      card.id = `ai-card-${index}`;

      const imgUrl = formatImageUrl(m.image_url);

      card.innerHTML = `
        <div class="card-img-wrap">
          <div class="card-badges">
            <span class="badge-pill confidence">${item.confidence}% 일치</span>
            <span class="badge-pill">${m.category_situation}</span>
          </div>
          <img class="card-img" src="${imgUrl}" alt="${m.title}" loading="lazy" onerror="this.src='./placeholder.png';">
        </div>
        <div class="card-body">
          <h3 class="card-situation">${escapeHtml(m.situation)}</h3>
          <div class="card-tags">
            <span class="tag-badge emotion">#${m.category_emotion}</span>
            <span class="tag-badge situation">#${m.category_situation}</span>
          </div>
          <div class="reason-box">
            💡 <strong>추천 이유:</strong> ${escapeHtml(item.reason)}
          </div>
          <div class="card-footer">
            <span>${escapeHtml(m.id)}</span>
            <span>위키 문서 보기 →</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => openModal(m.id));
      DOM.memeGrid.appendChild(card);
    });

  } catch (e) {
    console.error('AI Recommendation Error:', e);
    showToast('AI 추천 검색 중 오류가 발생했습니다.');
  } finally {
    DOM.loadingSpinner.style.display = 'none';
  }
}

function exitAiMode() {
  state.isAiMode = false;
  state.aiQuery = '';
  DOM.aiBanner.style.display = 'none';
  DOM.searchInput.value = '';
  DOM.btnClearSearch.style.display = 'none';
  fetchMemes(true);
}

// Reset Filters
function resetFilters() {
  state.filters = {
    q: '',
    emotion: '전체',
    situation: '전체',
    recipient: '전체',
    tier: '전체',
    source: '전체',
    sort: 'default'
  };
  DOM.searchInput.value = '';
  DOM.btnClearSearch.style.display = 'none';
  DOM.selectEmotion.value = '전체';
  DOM.selectSituation.value = '전체';
  DOM.selectRecipient.value = '전체';
  DOM.selectTier.value = '전체';
  DOM.selectSource.value = '전체';
  updateChipActiveState();
  if (state.isAiMode) {
    exitAiMode();
  } else {
    fetchMemes(true);
  }
}

// Modal Detail View
async function openModal(memeId) {
  try {
    let m = null;
    let related = [];

    if (!state.isStaticMode) {
      try {
        const res = await fetch(`/api/memes/${encodeURIComponent(memeId)}`);
        if (res.ok) {
          const data = await res.json();
          m = data.meme;
          related = data.related || [];
        }
      } catch (e) {}
    }

    if (!m) {
      const db = await loadStaticDbIfNeeded();
      if (db && db.memes) {
        m = db.memes.find(x => x.id === memeId || x.title === memeId);
        if (m) {
          related = db.memes
            .filter(x => x.id !== m.id && (x.category_emotion === m.category_emotion || x.category_situation === m.category_situation))
            .slice(0, 6);
        }
      }
    }

    if (!m) throw new Error('Not found');

    const imgUrl = formatImageUrl(m.image_url);

    const examplesHtml = m.examples && m.examples.length > 0
      ? m.examples.map(ex => `<li class="example-item">${escapeHtml(ex)}</li>`).join('')
      : '<li class="example-item">등록된 활용 예시가 없습니다.</li>';

    const keywordsHtml = m.keywords && m.keywords.length > 0
      ? m.keywords.map(kw => `<span class="kw-tag" data-kw="${escapeHtml(kw)}">#${escapeHtml(kw)}</span>`).join('')
      : '<span class="text-dim">키워드 없음</span>';

    const relatedHtml = related.map(rel => `
      <div class="related-thumb-card" data-rel-id="${escapeHtml(rel.id)}">
        <img class="related-thumb-img" src="${formatImageUrl(rel.image_url)}" alt="${rel.title}" loading="lazy" onerror="this.src='./placeholder.png';">
        <div class="related-thumb-title">${escapeHtml(rel.title)}</div>
      </div>
    `).join('');

    DOM.modalContent.innerHTML = `
      <div class="modal-grid">
        <!-- Image Column -->
        <div class="modal-img-col">
          <div class="modal-img-wrap">
            <img class="modal-img" id="detail-modal-img" src="${imgUrl}" alt="${m.title}" onerror="this.src='./placeholder.png';">
          </div>
          <div class="modal-img-actions">
            <button class="btn btn-secondary btn-sm" id="btn-copy-image-url" style="flex:1;">
              🔗 이미지 링크 복사
            </button>
            <a href="${imgUrl}" download="${m.id}" class="btn btn-primary btn-sm" style="flex:1; text-decoration:none;">
              💾 다운로드
            </a>
          </div>
          <div class="wiki-section-box">
            <div class="wiki-section-title">📌 수집 메타데이터</div>
            <table class="info-table">
              <tr><th>파일명</th><td>${escapeHtml(m.id)}</td></tr>
              <tr><th>데이터 출처</th><td>${escapeHtml(m.source_label)}</td></tr>
              <tr><th>안전 수위</th><td><span class="badge-pill">${escapeHtml(m.tier)}</span></td></tr>
              <tr><th>등록 일자</th><td>${escapeHtml(m.date || '2026-10')}</td></tr>
            </table>
          </div>
        </div>

        <!-- Info Column -->
        <div class="modal-info-col">
          <div class="modal-title-area">
            <div class="modal-meta-chips" style="margin-bottom: 10px;">
              <span class="tag-badge emotion">감정: ${escapeHtml(m.category_emotion)}</span>
              <span class="tag-badge situation">상황: ${escapeHtml(m.category_situation)}</span>
              <span class="tag-badge">수신인: ${escapeHtml(m.category_recipients.join(', '))}</span>
            </div>
            <h2>${escapeHtml(m.situation)}</h2>
          </div>

          <!-- Usage Examples -->
          <div class="wiki-section-box">
            <div class="wiki-section-title">💬 실생활 활용 예시 (3선)</div>
            <ul class="example-list">
              ${examplesHtml}
            </ul>
          </div>

          <!-- Emotion & Intent -->
          <div class="wiki-section-box">
            <div class="wiki-section-title">🎭 표현 의도 및 심리 상태</div>
            <table class="info-table">
              <tr><th>발신자 감정</th><td>${escapeHtml(m.emotions_raw || m.category_emotion)}</td></tr>
              <tr><th>표현 의도</th><td>${escapeHtml(m.intent || '상태 공유, 유머')}</td></tr>
              <tr><th>유머 유형</th><td>${escapeHtml(m.humor_type || '과장, 상황 비틀기')}</td></tr>
              <tr><th>추천 수신인</th><td>${escapeHtml(m.recipients_raw || m.category_recipients.join(', '))}</td></tr>
            </table>
          </div>

          ${m.cautions ? `
            <div class="caution-box">
              ⚠️ <strong>사용 시 주의사항:</strong> ${escapeHtml(m.cautions)}
            </div>
          ` : ''}

          <!-- Keywords -->
          <div class="wiki-section-box">
            <div class="wiki-section-title">🏷 검색 키워드</div>
            <div class="keyword-cloud">
              ${keywordsHtml}
            </div>
          </div>
        </div>
      </div>

      <!-- Related Memes -->
      ${related.length > 0 ? `
        <div class="modal-related-area">
          <h3 class="wiki-section-title">🔗 비슷한 감정·상황의 연관 밈</h3>
          <div class="related-grid">
            ${relatedHtml}
          </div>
        </div>
      ` : ''}
    `;

    // Event Bindings in Modal
    document.getElementById('btn-copy-image-url').addEventListener('click', () => {
      const fullUrl = new URL(imgUrl, document.baseURI).href;
      navigator.clipboard.writeText(fullUrl).then(() => {
        showToast('이미지 주소가 클립보드에 복사되었습니다.');
      });
    });

    // Keyword click -> search
    DOM.modalContent.querySelectorAll('.kw-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const kw = tag.dataset.kw;
        closeModal();
        DOM.searchInput.value = kw;
        DOM.btnClearSearch.style.display = 'block';
        state.filters.q = kw;
        fetchMemes(true);
      });
    });

    // Related click -> open that modal
    DOM.modalContent.querySelectorAll('.related-thumb-card').forEach(card => {
      card.addEventListener('click', () => {
        const relId = card.dataset.relId;
        openModal(relId);
      });
    });

    DOM.modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

  } catch (e) {
    console.error('Open modal error:', e);
    showToast('상세 정보를 불러올 수 없습니다.');
  }
}

function closeModal() {
  DOM.modal.style.display = 'none';
  document.body.style.overflow = '';
}

// Load Stats
async function loadStats() {
  try {
    let data = null;
    if (!state.isStaticMode) {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) data = await res.json();
      } catch (e) {}
    }
    if (!data) {
      const db = await loadStaticDbIfNeeded();
      if (db) data = db.stats;
    }
    if (!data) return;

    state.stats = data;
    DOM.statTotal.textContent = data.total_count;
    DOM.statHuman.textContent = data.human_count;
    DOM.statLlm.textContent = data.llm_count;
    DOM.badgeTotal.textContent = `${data.total_count} MEMES`;

    renderBarChart(DOM.chartEmotions, data.emotions, data.total_count);
    renderBarChart(DOM.chartSituations, data.situations, data.total_count);
  } catch (e) {
    console.error('Stats error:', e);
  }
}

function renderBarChart(container, dict, total) {
  container.innerHTML = '';
  const entries = Object.entries(dict).sort((a, b) => b[1] - a[1]);
  const maxVal = entries[0] ? entries[0][1] : 1;

  entries.forEach(([key, count]) => {
    const pct = Math.round((count / maxVal) * 100);
    const row = document.createElement('div');
    row.className = 'chart-bar-item';
    row.innerHTML = `
      <span class="bar-label">${escapeHtml(key)}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${pct}%;"></div>
      </div>
      <span class="bar-val">${count}</span>
    `;
    container.appendChild(row);
  });
}

// Toast Helper
let toastTimer = null;
function showToast(msg) {
  DOM.toast.textContent = msg;
  DOM.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    DOM.toast.classList.remove('show');
  }, 2500);
}

// Utility
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
