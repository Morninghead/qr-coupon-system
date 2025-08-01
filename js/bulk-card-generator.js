// public/js/bulk-card-generator.js

// --- 1. Global Variables ---
let supabaseClient = null;
let templates = [];
let employees = [];
let selectedEmployeeIds = [];
let pollingInterval = null; // ตัวแปรสำหรับหยุดการถามสถานะ

// --- 2. Main Initialization ---
document.addEventListener('DOMContentLoaded', initializeApp);

/**
 * ฟังก์ชันหลักที่เริ่มการทำงานทั้งหมด
 */
async function initializeApp() {
    const mainContent = document.getElementById('main-content');
    const loadingSection = document.getElementById('loading-section');
    mainContent.style.display = 'none';
    loadingSection.style.display = 'block';

    try {
        await initializeSupabase();
        await Promise.all([loadTemplates(), loadEmployees()]);
        setupEventListeners();
        mainContent.style.display = 'block';
        loadingSection.style.display = 'none';
        console.log('Bulk Card Generator initialized successfully.');
    } catch (error) {
        console.error('Initialization failed:', error);
        mainContent.innerHTML = `<div style="color: red; text-align: center; padding: 40px;"><h3>⚠️ Could not initialize the system.</h3><p>${error.message}</p></div>`;
        mainContent.style.display = 'block';
        loadingSection.style.display = 'none';
    }
}

// --- 3. Supabase & Data Loading Functions (ไม่มีการเปลี่ยนแปลง) ---

async function initializeSupabase() {
    // ... โค้ดส่วนนี้เหมือนเดิม ...
    const response = await fetch('/.netlify/functions/get-config');
    if (!response.ok) throw new Error(`Cannot get Supabase config: ${response.statusText}`);
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseKey);
}

async function loadTemplates() {
    // ... โค้ดส่วนนี้เหมือนเดิม ...
    const { data, error } = await supabaseClient.from('card_templates').select('*').order('template_name', { ascending: true });
    if (error) throw error;
    templates = data || [];
    populateTemplateSelect();
}

async function loadEmployees() {
    // ... โค้ดส่วนนี้เหมือนเดิม ...
    const { data, error } = await supabaseClient.from('employees').select('id, employee_id, name, department_name').order('name', { ascending: true });
    if (error) throw error;
    employees = data || [];
    populateEmployeeList();
    populateDepartmentFilter();
}

// --- 4. UI Population Functions (ไม่มีการเปลี่ยนแปลง) ---
function populateTemplateSelect() { /* ... โค้ดเดิม ... */ }
function populateEmployeeList() { /* ... โค้ดเดิม ... */ }
function populateDepartmentFilter() { /* ... โค้ดเดิม ... */ }

// --- 5. Event Handling (ไม่มีการเปลี่ยนแปลง) ---
function setupEventListeners() { /* ... โค้ดเดิม ... */ }
function handleTemplateChange(e) { /* ... โค้ดเดิม ... */ }
function selectAllEmployees() { /* ... โค้ดเดิม ... */ }
function toggleDepartmentFilter() { /* ... โค้ดเดิม ... */ }
function selectByDepartment(e) { /* ... โค้ดเดิม ... */ }
function updateSelectionSummary() { /* ... โค้ดเดิม ... */ }
function updateGenerateButton() { /* ... โค้ดเดิม ... */ }


// =========================================================================
// --- 6. CORE LOGIC (ปรับปรุงใหม่ทั้งหมดสำหรับ BACKGROUND JOBS) ---
// =========================================================================

/**
 * ฟังก์ชันหลักในการเริ่มต้นกระบวนการสร้าง PDF
 * ถูกเรียกเมื่อผู้ใช้กดปุ่ม "Generate Cards"
 */
async function generateCards() {
    // 1. ตรวจสอบข้อมูลเบื้องต้น
    const templateId = document.getElementById('template-select').value;
    if (!templateId) {
        alert('Please select a template.');
        return;
    }
    if (selectedEmployeeIds.length === 0) {
        alert('Please select at least one employee.');
        return;
    }

    // 2. เตรียมข้อมูลที่จะส่งไปสร้าง Job
    const selectedTemplate = templates.find(t => t.id === templateId);
    const selectedEmployees = employees.filter(emp => selectedEmployeeIds.includes(emp.id));

    // 3. อัปเดต UI ให้เข้าสู่สถานะ "กำลังทำงาน"
    const btn = document.getElementById('generate-cards-btn');
    const statusDisplay = document.getElementById('status-display');
    const downloadLink = document.getElementById('download-link');
    
    btn.disabled = true;
    btn.textContent = '⏳ Processing...';
    statusDisplay.style.display = 'block';
    statusDisplay.innerText = 'กำลังส่งคำสั่งสร้าง PDF ไปยังเซิร์ฟเวอร์...';
    downloadLink.style.display = 'none'; // ซ่อนลิงก์ดาวน์โหลดเก่า (ถ้ามี)

    if (pollingInterval) clearInterval(pollingInterval); // เคลียร์การถามสถานะเก่า

    try {
        // 4. ส่ง Request ไปยัง API เพื่อ "สร้างงาน" (Create Job)
        const response = await fetch('/.netlify/functions/request-bulk-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                template: selectedTemplate,
                employees: selectedEmployees
            })
        });

        if (!response.ok) {
            const errorResult = await response.json();
            throw new Error(errorResult.message || 'Could not start the PDF generation job.');
        }

        const { jobId } = await response.json();
        statusDisplay.innerText = `ได้รับ Job ID: ${jobId}. กำลังรอการประมวลผล...`;

        // 5. เริ่ม "Polling" หรือการถามสถานะทุกๆ 5 วินาที
        pollingInterval = setInterval(() => checkJobStatus(jobId), 5000);

    } catch (error) {
        console.error('Error starting PDF generation job:', error);
        statusDisplay.innerText = `เกิดข้อผิดพลาดในการเริ่มต้น: ${error.message}`;
        statusDisplay.style.color = 'red';
        btn.disabled = false;
        updateGenerateButton(); // รีเซ็ตข้อความบนปุ่ม
    }
}

/**
 * ฟังก์ชันสำหรับถามสถานะของงานจากเซิร์ฟเวอร์
 * @param {string} jobId - ID ของงานที่ต้องการตรวจสอบ
 */
async function checkJobStatus(jobId) {
    try {
        const response = await fetch(`/.netlify/functions/get-job-status?jobId=${jobId}`);
        const data = await response.json();

        const statusDisplay = document.getElementById('status-display');
        statusDisplay.innerText = `สถานะ: ${data.status}`;

        if (data.status === 'completed') {
            clearInterval(pollingInterval); // หยุดถามสถานะ
            statusDisplay.innerText = '✅ สร้างไฟล์ PDF สำเร็จ!';
            statusDisplay.style.color = 'green';
            
            const downloadLink = document.getElementById('download-link');
            downloadLink.href = data.result_url;
            downloadLink.style.display = 'block'; // แสดงปุ่มดาวน์โหลด
            
            document.getElementById('generate-cards-btn').disabled = false;
            updateGenerateButton();

        } else if (data.status === 'failed') {
            clearInterval(pollingInterval);
            statusDisplay.innerText = `❌ เกิดข้อผิดพลาด: ${data.error_message}`;
            statusDisplay.style.color = 'red';
            
            document.getElementById('generate-cards-btn').disabled = false;
            updateGenerateButton();
        }
        // ถ้าสถานะเป็น 'pending' หรือ 'processing' ก็จะทำงานต่อไปในรอบหน้า

    } catch (error) {
        console.error('Error checking job status:', error);
        // อาจจะหยุด Polling ถ้าเกิดข้อผิดพลาดในการเชื่อมต่อ
        clearInterval(pollingInterval);
        document.getElementById('status-display').innerText = 'เกิดข้อผิดพลาดในการตรวจสอบสถานะ';
    }
}
