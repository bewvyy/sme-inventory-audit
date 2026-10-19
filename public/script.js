let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;
let allProductsList = [];

document.addEventListener('DOMContentLoaded', () => {
  updateUI();
});

function updateUI() {
  const loginSection = document.getElementById('login-section');
  const appSection = document.getElementById('app-section');
  const adminSection = document.getElementById('admin-audit-section');
  const adminUserMgmtSection = document.getElementById('admin-user-mgmt-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const cardAfterHours = document.getElementById('card-after-hours');
  const userBadge = document.getElementById('current-user');
  const logoutBtn = document.getElementById('logout-btn');

  if (currentUser) {
    loginSection.style.display = 'none';
    appSection.style.display = 'block';
    dashboardSection.style.display = 'block';
    logoutBtn.style.display = 'inline-block';
    userBadge.textContent = `${currentUser.name} (${currentUser.role})`;

    loadProducts();
    loadDashboardStats();

    // แสดงการ์ดความเสี่ยงสูง + เมนู Admin เฉพาะบทบาท admin เท่านั้น[cite: 1, 2]
    if (currentUser.role === 'admin') {
      adminSection.style.display = 'block';
      adminUserMgmtSection.style.display = 'block';
      if (cardAfterHours) cardAfterHours.style.display = 'flex';
      loadAuditLogs();
    } else {
      adminSection.style.display = 'none';
      adminUserMgmtSection.style.display = 'none';
      if (cardAfterHours) cardAfterHours.style.display = 'none';
    }
  } else {
    loginSection.style.display = 'block';
    appSection.style.display = 'none';
    adminSection.style.display = 'none';
    adminUserMgmtSection.style.display = 'none';
    dashboardSection.style.display = 'none';
    if (cardAfterHours) cardAfterHours.style.display = 'none';
    logoutBtn.style.display = 'none';
    userBadge.textContent = 'ไม่ได้เข้าสู่ระบบ';
  }
}

// ฟอร์มเข้าสู่ระบบ
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (res.ok) {
      currentUser = data;
      localStorage.setItem('currentUser', JSON.stringify(data));
      document.getElementById('login-form').reset();
      updateUI();
    } else {
      alert(data.error);
    }
  } catch (err) {
    console.error('Error logging in:', err);
  }
});

function logout() {
  currentUser = null;
  localStorage.removeItem('currentUser');
  updateUI();
}

// 1. ดึงข้อมูลสินค้า
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    allProductsList = await res.json();
    filterProducts();
    document.getElementById('stat-total-types').textContent = allProductsList.length;
  } catch (err) {
    console.error('Error loading products:', err);
  }
}

// คำนวณสถิติจาก Audit Log แสดงบน Dashboard[cite: 4]
async function loadDashboardStats() {
  try {
    const res = await fetch('/api/audit-logs');
    if (!res.ok) return;

    const logs = await res.json();
    const todayStr = new Date().toDateString();

    let todayActionsCount = 0;
    let totalRestockedQty = 0;
    let totalExportedQty = 0;
    let afterHoursCount = 0;

    logs.forEach(log => {
      const logDate = new Date(log.timestamp);
      
      // กิจกรรมทั้งหมดในวันนี้
      if (logDate.toDateString() === todayStr) {
        todayActionsCount++;
      }

      if (log.action && log.action.includes('AFTER_HOURS')) {
        afterHoursCount++;
      }

      // คำนวณยอดรับเข้าและส่งออก
      if (log.details) {
        const match = log.details.match(/จำนวน (\d+) ชิ้น/);
        if (match) {
          const qty = parseInt(match[1], 10);
          if (log.action.includes('RESTOCK') || log.action.includes('CREATE')) {
            totalRestockedQty += qty;
          } else if (log.action.includes('EXPORT')) {
            totalExportedQty += qty;
          }
        }
      }
    });

    document.getElementById('stat-today-actions').textContent = todayActionsCount;
    document.getElementById('stat-total-restocked').textContent = totalRestockedQty.toLocaleString();
    document.getElementById('stat-total-exported').textContent = totalExportedQty.toLocaleString();
    
    const afterHoursElem = document.getElementById('stat-after-hours');
    if (afterHoursElem) afterHoursElem.textContent = afterHoursCount;
  } catch (err) {
    console.error('Error loading dashboard stats:', err);
  }
}

// ค้นหา และกรองสินค้า
function filterProducts() {
  const searchText = document.getElementById('search-input').value.toLowerCase();
  const filterValue = document.getElementById('filter-stock').value;
  const tbody = document.getElementById('product-table-body');
  tbody.innerHTML = '';

  const filtered = allProductsList.filter(p => {
    const matchesSearch = p.product_id.toLowerCase().includes(searchText) || 
                          p.product_name.toLowerCase().includes(searchText);
    
    let matchesStock = true;
    if (filterValue === 'low') matchesStock = p.quantity < 5;
    if (filterValue === 'normal') matchesStock = p.quantity >= 5;

    return matchesSearch && matchesStock;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">ไม่พบข้อมูลสินค้า</td></tr>';
    return;
  }

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    const isLowStock = p.quantity < 5;

    if (isLowStock) {
      tr.classList.add('low-stock-row');
    }

    tr.innerHTML = `
      <td>${escapeHtml(p.product_id)}</td>
      <td>
        <strong>${escapeHtml(p.product_name)}</strong>
        ${isLowStock ? '<span class="badge-danger">สต็อกต่ำ!</span>' : ''}
      </td>
      <td><strong>${p.quantity}</strong> ชิ้น</td>
      <td>
        <button onclick="handleStock('${p._id}', 'RESTOCK')">เติมสต็อก</button>
        <button onclick="handleStock('${p._id}', 'EXPORT')">เบิก/ส่งออก</button>
        <button class="btn-red" onclick="deleteProduct('${p._id}')">ลบ</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ปรับสต็อก (เติม / เบิก)
async function handleStock(id, actionType) {
  const actionText = actionType === 'RESTOCK' ? 'เติม' : 'เบิก';
  const amount = prompt(`ระบุจำนวนที่ต้องการ ${actionText}:`);
  if (!amount || isNaN(amount) || amount <= 0) return;

  const note = prompt(`ระบุหมายเหตุ / เหตุผลการ${actionText}:`);

  try {
    const res = await fetch(`/api/products/${id}/stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionType, amount, note, username: currentUser.username })
    });

    const data = await res.json();
    if (!res.ok) alert(data.error);

    loadProducts();
    loadDashboardStats();
    if (currentUser.role === 'admin') loadAuditLogs();
  } catch (err) {
    console.error('Error updating stock:', err);
  }
}

// ลบสินค้า
async function deleteProduct(id) {
  if (!confirm('คุณต้องการลบสินค้านี้ใช่หรือไม่?')) return;

  try {
    await fetch(`/api/products/${id}?username=${currentUser.username}`, { method: 'DELETE' });
    loadProducts();
    loadDashboardStats();
    if (currentUser.role === 'admin') loadAuditLogs();
  } catch (err) {
    console.error('Error deleting product:', err);
  }
}

// ดึง Audit Logs (แสดงเฉพาะแอดมินลงตาราง)[cite: 1, 2]
async function loadAuditLogs() {
  if (!currentUser || currentUser.role !== 'admin') return;

  try {
    const res = await fetch('/api/audit-logs');
    if (!res.ok) return;

    const logs = await res.json();
    const tbody = document.getElementById('log-table-body');
    tbody.innerHTML = '';

    logs.forEach(log => {
      const tr = document.createElement('tr');
      const isAfterHours = log.action.includes('AFTER_HOURS');
      if (isAfterHours) tr.classList.add('warning-row');

      tr.innerHTML = `
        <td>${new Date(log.timestamp).toLocaleString('th-TH')}</td>
        <td><strong>${escapeHtml(log.username)}</strong></td>
        <td><span class="badge">${log.action}</span></td>
        <td>${escapeHtml(log.details)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading audit logs:', err);
  }
}

// เพิ่มสินค้าใหม่
document.getElementById('add-product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const productId = document.getElementById('p-id').value.trim();
  const productName = document.getElementById('p-name').value.trim();
  const quantity = parseInt(document.getElementById('p-qty').value, 10);

  if (quantity < 0) {
    alert('จำนวนสินค้าต้องไม่ติดลบ!');
    return;
  }

  const isDuplicate = allProductsList.some(p => p.product_id.toLowerCase() === productId.toLowerCase());
  if (isDuplicate) {
    alert(`รหัสสินค้า "${productId}" มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น`);
    return;
  }

  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, productName, quantity, username: currentUser.username })
    });

    if (res.ok) {
      e.target.reset();
      loadProducts();
      loadDashboardStats();
      if (currentUser.role === 'admin') loadAuditLogs();
    } else {
      const data = await res.json();
      alert(data.error || 'เกิดข้อผิดพลาดในการเพิ่มสินค้า');
    }
  } catch (err) {
    console.error('Error adding product:', err);
  }
});

// สร้างพนักงานใหม่
document.getElementById('create-user-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('new-username').value.trim();
  const name = document.getElementById('new-name').value.trim();
  const email = document.getElementById('new-email').value.trim();
  const password = document.getElementById('new-password').value;
  const role = document.getElementById('new-role').value;

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, name, email, password, role })
    });

    const data = await res.json();
    if (res.ok) {
      alert(`สร้างบัญชีสำหรับคุณ ${data.name} (${data.role}) เรียบร้อยแล้ว`);
      e.target.reset();
    } else {
      alert(data.error || 'ไม่สามารถสร้างบัญชีได้');
    }
  } catch (err) {
    console.error('Error creating user:', err);
  }
});

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
