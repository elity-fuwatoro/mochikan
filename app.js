const DB_NAME = 'PatientManagerDB';
const DB_VERSION = 1;
const STORE_NAME = 'patients';

let db;
let currentTab = 'active'; // 'active' or 'inactive'
let patientsData = [];

// ==========================================
// IndexedDB Wrapper
// ==========================================
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (e) => {
      console.error("IndexedDB error:", e.target.error);
      reject(e.target.error);
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function getAllPatients() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putPatient(patient) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(patient);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function bulkPutPatients(patients) {
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  for (const p of patients) {
    store.put(p);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ==========================================
// Date Utils & Daily Reset Logic
// ==========================================
function getTodayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function performDailyReset(patients) {
  const today = getTodayStr();
  let updated = false;

  for (const p of patients) {
    if (p.lastCheckedDate !== today) {
      // 日付が変わっていれば、カルテ記載フラグをクリア
      p.karteDone = false;
      p.lastCheckedDate = today;
      updated = true;
      await putPatient(p);
    }
  }
  return updated;
}

// ==========================================
// App Initialization
// ==========================================
async function loadDataAndRender() {
  try {
    patientsData = await getAllPatients();

    // 日めくりクリア処理
    const dataUpdated = await performDailyReset(patientsData);
    if (dataUpdated) {
      // メモリ上のデータも再取得
      patientsData = await getAllPatients();
    }

    renderCards();
  } catch (e) {
    alert("データの読み込みに失敗しました。");
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  await loadDataAndRender();
  setupEventListeners();
});

// ==========================================
// Event Listeners Initialization
// ==========================================
function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const target = e.target;
      target.classList.add('active');
      currentTab = target.dataset.tab;
      renderCards();
    });
  });

  document.getElementById('btnAddPatient').addEventListener('click', () => openPatientModal(null));
  document.getElementById('btnCloseModal').addEventListener('click', closePatientModal);
  document.getElementById('btnCancelPatient').addEventListener('click', closePatientModal);
  document.getElementById('btnSavePatient').addEventListener('click', savePatient);

  // Inactive Checkbox logic in Edit Modal
  const isInactiveCheckbox = document.getElementById('p_isInactive');
  const inactiveDateGroup = document.getElementById('inactiveDateGroup');
  isInactiveCheckbox.addEventListener('change', (e) => {
    inactiveDateGroup.style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked && !document.getElementById('p_inactiveDate').value) {
      document.getElementById('p_inactiveDate').value = getTodayStr(); // auto-fill today
    }
  });

  // Settings / Export-Import
  document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
  document.getElementById('btnCloseSettings').addEventListener('click', closeSettingsModal);
  document.getElementById('btnExport').addEventListener('click', exportJSON);
  document.getElementById('importFile').addEventListener('change', importJSON);

  // Date Mini Modal
  document.getElementById('btnClearDate').addEventListener('click', clearRxDate);
  document.getElementById('btnSaveDate').addEventListener('click', saveRxDate);

  document.getElementById('dateUpdateModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('dateUpdateModal')) {
      closeDateModal();
    }
  });
}

// ==========================================
// Rendering Logic
// ==========================================
function renderCards() {
  const container = document.getElementById('patientListContainer');
  container.innerHTML = '';

  const filtered = patientsData.filter(p => {
    const isInactive = p.isActive === false;
    if (currentTab === 'active') return !isInactive;
    return isInactive;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="svg-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        <p>${currentTab === 'active' ? '担当患者はいません。右上の追加ボタンから登録してください。' : '担当外の患者はいません。'}</p>
      </div>
    `;
    return;
  }

  // Sort logic
  filtered.sort((a, b) => {
    if (currentTab === 'active') {
      const roomA = a.roomNumber ? String(a.roomNumber) : '\uFFFF';
      const roomB = b.roomNumber ? String(b.roomNumber) : '\uFFFF';
      return roomA.localeCompare(roomB, undefined, { numeric: true, sensitivity: 'base' });
    } else {
      const dateA = a.inactiveDate || '';
      const dateB = b.inactiveDate || '';
      if (dateA > dateB) return -1;
      if (dateA < dateB) return 1;
      return 0;
    }
  });

  filtered.forEach(p => {
    container.appendChild(createPatientCard(p));
  });
}

function createPatientCard(p) {
  const card = document.createElement('div');
  card.className = `patient-card ${p.isActive === false ? 'inactive' : ''}`;
  card.dataset.id = p.id;

  const today = getTodayStr();

  // Helper for Rx Date formatting
  const renderRxNode = (label, dateVal, targetField) => {
    const isPastOrToday = dateVal && dateVal <= today;
    const isToday = dateVal === today;
    const isPast = dateVal && dateVal < today;

    let stateClass = '';
    if (isPastOrToday) {
      stateClass = isToday ? 'urgent' : 'warn';
    }

    return `
      <div class="rx-item ${stateClass}" onclick="openDateModal('${p.id}', '${targetField}', '${label}', '${dateVal || ''}')">
        <span class="rx-label">${label}</span>
        <span class="rx-date">${dateVal ? formatDateSimple(dateVal) : '未設定'}</span>
      </div>
    `;
  };

  card.innerHTML = `
    <div class="card-header">
      <div class="patient-name-wrapper">
        <span class="patient-name">${p.roomNumber ? `<span class="pill" style="margin-right:6px; background-color:#e2e8f0; color:#334155; font-size:0.85rem;">${escapeHTML(p.roomNumber)}</span>` : ''}${escapeHTML(p.name)}</span>
        <span class="patient-meta">
          (${p.age ? `${escapeHTML(p.age)}歳 ` : ''}${p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '他'})${p.pns ? ` <span style="margin-left:6px;">PNs:${escapeHTML(p.pns)}</span>` : ''}
        </span>
      </div>
      <div class="karte-check-wrapper" onclick="toggleKarte(event, '${p.id}')">
        <input type="checkbox" class="karte-checkbox" ${p.karteDone ? 'checked' : ''} tabindex="-1">
        <label>カルテ</label>
      </div>
    </div>

    ${currentTab === 'inactive' ? `
      <div class="data-grid" style="grid-template-columns: 1fr 1fr;">
        <div class="data-item"><span class="data-label">入院日</span><span class="data-value">${p.admissionDate ? formatDateSimple(p.admissionDate) : '-'}</span></div>
        <div class="data-item alert-group" style="padding:6px; margin:0;"><span class="data-label" style="color:#b91c1c;">担当外日</span><span class="data-value" style="color:#b91c1c;">${p.inactiveDate ? formatDateSimple(p.inactiveDate) : '-'}</span></div>
      </div>
    ` : ''}

    <div class="data-grid">
      <div class="data-item"><span class="data-label">主病名</span><span class="data-value">${escapeHTML(p.disease) || '-'}</span></div>
      <div class="data-item"><span class="data-label">転移部</span><span class="data-value">${escapeHTML(p.metastasis) || '-'}</span></div>
      <div class="data-item"><span class="data-label">肝機能</span><span class="data-value">${escapeHTML(p.liverFunc) || '-'}</span></div>
      <div class="data-item"><span class="data-label">腎機能</span><span class="data-value">${escapeHTML(p.kidneyFunc) || '-'}</span></div>
      <div class="data-item"><span class="data-label">採血日</span><span class="data-value">${p.lastBloodTestDate ? formatDateSimple(p.lastBloodTestDate) : '-'}</span></div>
      <div class="data-item"><span class="data-label">IC日</span><span class="data-value">${p.lastIcDate ? formatDateSimple(p.lastIcDate) : '-'}</span></div>
    </div>
    
    ${p.icContent ? `
      <div class="data-grid single-col">
        <div class="data-item"><span class="data-label">IC内容</span><span class="data-value" style="font-size:0.8rem;">${escapeHTML(p.icContent)}</span></div>
      </div>
    ` : ''}

    ${p.remark ? `
      <div class="data-grid single-col">
        <div class="data-item"><span class="data-label">備考</span><span class="data-value" style="font-size:0.8rem; white-space:pre-wrap;">${escapeHTML(p.remark)}</span></div>
      </div>
    ` : ''}

    ${currentTab === 'active' ? `
      <div class="rx-grid">
        ${renderRxNode('次回 点滴', p.nextIvDashDate, 'nextIvDashDate')}
        ${renderRxNode('次回 内服', p.nextPoRxDate, 'nextPoRxDate')}
        ${renderRxNode('次回 麻薬', p.nextNarcoticRxDate, 'nextNarcoticRxDate')}
      </div>
    ` : ''}

    <button class="card-edit-btn" onclick="openPatientModal('${p.id}')">
      <svg class="svg-icon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> 編集
    </button>
  `;

  return card;
}

// Inline Karte toggle
window.toggleKarte = async (e, id) => {
  // Prevent double trigger if clicked on checkbox itself vs wrapper
  if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL' && e.target.tagName !== 'DIV') return;

  const checkbox = e.currentTarget.querySelector('.karte-checkbox');
  // If clicked wrapper, manually toggle checkbox
  if (e.target.tagName !== 'INPUT') {
    checkbox.checked = !checkbox.checked;
  }

  const p = patientsData.find(x => x.id === id);
  if (p) {
    p.karteDone = checkbox.checked;
    await putPatient(p);
  }
};

// ==========================================
// Patient Form Modal
// ==========================================
function openPatientModal(id) {
  const isEdit = !!id;
  document.getElementById('modalTitle').textContent = isEdit ? '患者情報 編集' : '新規患者登録';

  // Reset form
  document.getElementById('patientForm').reset();
  document.getElementById('p_id').value = '';
  document.getElementById('inactiveSection').style.display = isEdit ? 'block' : 'none';
  document.getElementById('inactiveDateGroup').style.display = 'none';

  if (isEdit) {
    const p = patientsData.find(x => x.id === id);
    if (p) {
      document.getElementById('p_id').value = p.id;
      document.getElementById('p_roomNumber').value = p.roomNumber || '';
      document.getElementById('p_name').value = p.name || '';
      document.getElementById('p_pns').value = p.pns || '';
      document.getElementById('p_age').value = p.age || '';
      document.getElementById('p_gender').value = p.gender || 'other';
      document.getElementById('p_disease').value = p.disease || '';
      document.getElementById('p_metastasis').value = p.metastasis || '';
      document.getElementById('p_liver').value = p.liverFunc || '';
      document.getElementById('p_kidney').value = p.kidneyFunc || '';
      document.getElementById('p_admissionDate').value = p.admissionDate || '';

      document.getElementById('p_karteDone').checked = !!p.karteDone;
      document.getElementById('p_nextIvDashDate').value = p.nextIvDashDate || '';
      document.getElementById('p_nextPoRxDate').value = p.nextPoRxDate || '';
      document.getElementById('p_nextNarcoticRxDate').value = p.nextNarcoticRxDate || '';
      document.getElementById('p_lastBloodTestDate').value = p.lastBloodTestDate || '';
      document.getElementById('p_lastIcDate').value = p.lastIcDate || '';
      document.getElementById('p_icContent').value = p.icContent || '';
      document.getElementById('p_remark').value = p.remark || '';

      const isInactive = p.isActive === false;
      document.getElementById('p_isInactive').checked = isInactive;
      if (isInactive) {
        document.getElementById('inactiveDateGroup').style.display = 'block';
        document.getElementById('p_inactiveDate').value = p.inactiveDate || '';
      }
    }
  } else {
    // 新規作成時は入院日のデフォルトを今日に
    document.getElementById('p_admissionDate').value = getTodayStr();
  }

  document.getElementById('patientModal').classList.remove('hidden');

  // 編集時は「日々データ」部分まで、新規時は一番上（基礎データ）まで自動スクロール
  setTimeout(() => {
    const modalBody = document.querySelector('#patientModal .modal-body');
    if (isEdit) {
      const dailyDataSection = document.getElementById('p_karteDone').closest('.form-section');
      if (dailyDataSection && modalBody) {
        // modal-body のスクロール位置を、対象要素の相対位置に合わせる（より確実なスクロール）
        modalBody.scrollTop = dailyDataSection.offsetTop - 20;
      }
    } else {
      if (modalBody) {
        modalBody.scrollTop = 0;
      }
    }
  }, 100); // UIの表示を待ってからスクロール
}

function closePatientModal() {
  document.getElementById('patientModal').classList.add('hidden');
}

async function savePatient(e) {
  e.preventDefault();
  const nameInput = document.getElementById('p_name');
  if (!nameInput.value.trim()) {
    alert("氏名を入力してください");
    nameInput.focus();
    return;
  }

  const idVal = document.getElementById('p_id').value;
  const isNew = !idVal;

  const patient = {
    id: isNew ? Date.now().toString() : idVal,
    lastCheckedDate: getTodayStr(), // 最終保存・確認日
    roomNumber: document.getElementById('p_roomNumber').value.trim(),
    name: nameInput.value.trim(),
    pns: document.getElementById('p_pns').value.trim(),
    age: document.getElementById('p_age').value,
    gender: document.getElementById('p_gender').value,
    disease: document.getElementById('p_disease').value,
    metastasis: document.getElementById('p_metastasis').value,
    liverFunc: document.getElementById('p_liver').value,
    kidneyFunc: document.getElementById('p_kidney').value,
    admissionDate: document.getElementById('p_admissionDate').value,

    karteDone: document.getElementById('p_karteDone').checked,
    nextIvDashDate: document.getElementById('p_nextIvDashDate').value,
    nextPoRxDate: document.getElementById('p_nextPoRxDate').value,
    nextNarcoticRxDate: document.getElementById('p_nextNarcoticRxDate').value,
    lastBloodTestDate: document.getElementById('p_lastBloodTestDate').value,
    lastIcDate: document.getElementById('p_lastIcDate').value,
    icContent: document.getElementById('p_icContent').value,
    remark: document.getElementById('p_remark').value,
  };

  // Archive logic
  const isInactiveChecked = document.getElementById('p_isInactive').checked;
  if (isNew) {
    patient.isActive = true;
    patient.inactiveDate = null;
  } else {
    patient.isActive = !isInactiveChecked;
    patient.inactiveDate = isInactiveChecked ? document.getElementById('p_inactiveDate').value : null;
  }

  // Preserve existing fields if we missed any (like history if we had it, but we dropped it)
  if (!isNew) {
    const oldP = patientsData.find(x => x.id === patient.id);
    if (oldP && oldP.lastCheckedDate) {
      patient.lastCheckedDate = oldP.lastCheckedDate;
    }
  }

  await putPatient(patient);
  closePatientModal();
  await loadDataAndRender();
}

// ==========================================
// Date Update Mini Modal
// ==========================================
let currentUpdatingDateMeta = null; // { id, field }

window.openDateModal = (id, field, label, currentDate) => {
  currentUpdatingDateMeta = { id, field };
  const p = patientsData.find(x => x.id === id);

  document.getElementById('dateUpdateTitle').textContent = `${label} の更新`;
  document.getElementById('dateUpdateDesc').textContent = p ? `対象: ${p.name} 様` : '';

  document.getElementById('newDateInput').value = currentDate || '';
  document.getElementById('dateUpdateModal').classList.remove('hidden');
};

function closeDateModal() {
  document.getElementById('dateUpdateModal').classList.add('hidden');
  currentUpdatingDateMeta = null;
}

async function saveRxDate() {
  if (!currentUpdatingDateMeta) return;
  const { id, field } = currentUpdatingDateMeta;
  const p = patientsData.find(x => x.id === id);
  if (p) {
    p[field] = document.getElementById('newDateInput').value;
    await putPatient(p);
    closeDateModal();
    await loadDataAndRender();
  }
}

async function clearRxDate() {
  if (!currentUpdatingDateMeta) return;
  const { id, field } = currentUpdatingDateMeta;
  const p = patientsData.find(x => x.id === id);
  if (p) {
    p[field] = '';
    await putPatient(p);
    closeDateModal();
    await loadDataAndRender();
  }
}

// ==========================================
// Settings Modal & Export/Import
// ==========================================
function openSettingsModal() {
  document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function exportJSON() {
  const dataStr = JSON.stringify(patientsData, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `patient_data_${getTodayStr().replace(/-/g, '')}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error("不正なデータ形式です（配列ではありません）");

      if (confirm("既存のデータを全て上書きしてよろしいですか？")) {
        // Clear old database records is better, but since we overwrite matched IDs, let's just use bulkPut.
        // Actually to be perfectly safe, we should clear the store first.
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();

        tx.oncomplete = async () => {
          await bulkPutPatients(data);
          e.target.value = ''; // reset input
          closeSettingsModal();
          alert("復元が完了しました。");
          await loadDataAndRender();
        };
      }
    } catch (err) {
      alert("インポートに失敗しました。ファイルが壊れている可能性があります。\n" + err.message);
    }
  };
  reader.readAsText(file);
}

// ==========================================
// Utilities
// ==========================================
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateSimple(ymd) {
  if (!ymd) return '';
  const parts = ymd.split('-');
  if (parts.length < 3) return ymd;
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

// ==========================================
// Service Worker Registration for PWA
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(registration => {
      console.log('SW registered: ', registration.scope);
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}
