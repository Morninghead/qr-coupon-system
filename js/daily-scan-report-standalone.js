// js/daily-scan-report-standalone.js

const reportTableBody = document.getElementById('report-table-body');
const paginationControls = document.getElementById('pagination-controls');
const baseUrl = window.location.origin; // เพื่อให้ URL ของ Function ถูกต้อง

async function initializePage() {
    // หน้านี้ไม่ต้องการการ Login ดังนั้นเรียก fetchReport ได้เลย
    await fetchReport(1); // โหลดรายงานหน้าแรกทันทีเมื่อหน้าโหลดเสร็จ
}

async function fetchReport(page = 1) {
    try {
        reportTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">กำลังโหลดรายงาน...</td></tr>`;
        paginationControls.innerHTML = ''; // เคลียร์ pagination controls

        // เรียก Netlify Function get-scan-report โดยไม่มี Authorization header
        // เพราะ get-scan-report.js ถูกปรับให้ใช้ Service Role Key แล้ว
        const response = await fetch(`${baseUrl}/.netlify/functions/get-scan-report?page=${page}`);
        
        if (!response.ok) {
            const errorData = await response.json(); // อ่าน error message จาก backend
            throw new Error(errorData.message || 'ไม่สามารถโหลดรายงานได้');
        }
        
        const report = await response.json();
        renderReport(report.data);
        renderPagination(report.currentPage, report.totalPages);

    } catch (error) {
        console.error('Failed to fetch report:', error);
        reportTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:red;">ผิดพลาด: ${error.message}</td></tr>`;
        paginationControls.innerHTML = '';
    }
}

function renderReport(data) {
    if (!data || data.length === 0) {
        reportTableBody.innerHTML = `<tr><td colspan="5" class="no-data-message">ยังไม่มีการสแกนสำหรับวันนี้</td></tr>`;
        return;
    }

    reportTableBody.innerHTML = data.map(item => `
        <tr>
            <td>${new Date(item.used_at).toLocaleTimeString('th-TH')}</td>
            <td>${item.employee_id || 'N/A'}</td> 
            <td>${item.name || 'ไม่ระบุชื่อ'}</td> 
            <td>${item.coupon_type}</td>
            <td>${item.source === 'daily_coupon' ? 'พนักงานประจำ' : 'ชั่วคราว'}</td>
        </tr>
    `).join('');
}

function renderPagination(currentPage, totalPages) {
    if (totalPages <= 1) {
        paginationControls.innerHTML = '';
        return;
    }
    
    let buttonsHtml = `<button onclick="fetchReport(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>ก่อนหน้า</button>`;
    buttonsHtml += `<span>หน้า ${currentPage} / ${totalPages}</span>`;
    buttonsHtml += `<button onclick="fetchReport(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>ถัดไป</button>`;
    
    paginationControls.innerHTML = buttonsHtml;
}

// เริ่มต้นการทำงานเมื่อ DOM โหลดเสร็จ
document.addEventListener('DOMContentLoaded', initializePage);