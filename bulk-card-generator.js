// --- 1. Global Variables ---
// ตัวแปรสำหรับเก็บค่าต่างๆ ที่ใช้ร่วมกันในหน้านี้
let supabaseClient = null;
let templates = [];
let employees = [];
let departments = [];
let selectedEmployeeIds = [];

// --- 2. Main Initialization ---
// รอให้ HTML โหลดเสร็จก่อน แล้วค่อยเริ่มทำงาน
document.addEventListener('DOMContentLoaded', initializeApp);

/**
 * ฟังก์ชันหลักสำหรับเริ่มต้นการทำงานของหน้าเว็บ
 * - เชื่อมต่อ Supabase
 * - โหลดข้อมูล Template และ พนักงาน
 * - ตั้งค่า Event Listener ให้กับปุ่มและเมนูต่างๆ
 */
async function initializeApp() {
    const mainContent = document.getElementById('main-content');
    const loadingSection = document.getElementById('loading-section');
    mainContent.style.display = 'none';
    loadingSection.style.display = 'block';

    try {
        await initializeSupabase();
        
        // โหลดข้อมูล templates และ employees พร้อมกันเพื่อความรวดเร็ว
        await Promise.all([
            loadTemplates(),
            loadEmployees()
        ]);
        
        setupEventListeners();

        // เมื่อทุกอย่างพร้อมแล้ว ซ่อน loading และแสดงเนื้อหาหลัก
        mainContent.style.display = 'block';
        loadingSection.style.display = 'none';
        console.log('Bulk Card Generator initialized successfully.');

    } catch (error) {
        console.error('Initialization failed:', error);
        // แสดงข้อความ Error บนหน้าจอหากการเริ่มต้นล้มเหลว
        mainContent.innerHTML = `<div style="color: red; text-align: center; padding: 40px;"><h3>⚠️ ไม่สามารถเริ่มต้นระบบได้</h3><p>${error.message}</p></div>`;
        mainContent.style.display = 'block';
        loadingSection.style.display = 'none';
    }
}

// --- 3. Supabase & Data Loading Functions ---

/**
 * ดึงค่า Config และเชื่อมต่อกับ Supabase
 */
async function initializeSupabase() {
    try {
        const response = await fetch('/.netlify/functions/get-config');
        if (!response.ok) throw new Error(`Cannot get Supabase config: ${response.statusText}`);
        
        const config = await response.json();
        if (!config.supabaseUrl || !config.supabaseKey) {
            throw new Error('Invalid Supabase configuration received.');
        }
        
        // ใช้ Supabase global object ที่ถูกโหลดในไฟล์ HTML
        supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseKey);
        console.log('Supabase client initialized.');

    } catch (error) {
        console.error('Failed to initialize Supabase:', error);
        throw error; // ส่ง error ต่อเพื่อให้ initializeApp จัดการ
    }
}

/**
 * โหลดข้อมูล Card Templates ทั้งหมดจาก Supabase
 */
async function loadTemplates() {
    if (!supabaseClient) throw new Error('Supabase client not initialized.');

    try {
        const { data, error } = await supabaseClient
            .from('card_templates')
            .select('*')
            .order('template_name', { ascending: true });

        if (error) throw error;
        templates = data || [];
        populateTemplateSelect();
        console.log(`Loaded ${templates.length} templates.`);
    } catch (error) {
        console.error('Failed to load templates:', error);
        document.getElementById('template-select').innerHTML = '<option value="">ไม่สามารถโหลด Templates ได้</option>';
    }
}

/**
 * โหลดข้อมูลพนักงานทั้งหมดจาก Supabase
 */
async function loadEmployees() {
    if (!supabaseClient) throw new Error('Supabase client not initialized.');

    try {
        const { data, error } = await supabaseClient
            .from('employees')
            .select('id, employee_id, name, department_name') // ดึง department_name มาด้วย
            .order('name', { ascending: true });

        if (error) throw error;
        employees = data || [];
        populateEmployeeList();
        populateDepartmentFilter();
        console.log(`Loaded ${employees.length} employees.`);
    } catch (error) {
        console.error('Failed to load employees:', error);
        document.getElementById('employee-list').innerHTML = '<p style="color: red;">ไม่สามารถโหลดรายชื่อพนักงานได้</p>';
    }
}

// --- 4. UI Population Functions ---

/**
 * นำข้อมูล Templates ไปใส่ใน Dropdown
 */
function populateTemplateSelect() {
    const select = document.getElementById('template-select');
    if (templates.length === 0) {
        select.innerHTML = '<option value="">ไม่พบ Templates</option>';
        return;
    }
    select.innerHTML = '<option value="">-- กรุณาเลือก Template --</option>';
    templates.forEach(template => {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = `${template.template_name} (${template.company_name || 'N/A'})`;
        select.appendChild(option);
    });
}

/**
 * นำข้อมูลพนักงานไปแสดงเป็นรายการพร้อม Checkbox
 */
function populateEmployeeList() {
    const listEl = document.getElementById('employee-list');
    listEl.innerHTML = '';

    if (employees.length === 0) {
        listEl.innerHTML = '<p>ไม่พบข้อมูลพนักงาน</p>';
        return;
    }

    employees.forEach(employee => {
        const item = document.createElement('div');
        item.className = 'employee-item';
        item.innerHTML = `
            <input type="checkbox" id="emp-${employee.id}" data-employee-id="${employee.id}" class="employee-checkbox">
            <label for="emp-${employee.id}" style="margin-left: 8px; cursor: pointer;">
                ${employee.name} (${employee.employee_id}) - ${employee.department_name || 'ไม่ระบุแผนก'}
            </label>
        `;
        listEl.appendChild(item);
    });
}

/**
 * สร้างตัวกรองแผนกจากข้อมูลพนักงาน
 */
function populateDepartmentFilter() {
    const depts = [...new Set(employees.map(emp => emp.department_name).filter(Boolean))];
    depts.sort(); // เรียงตามตัวอักษร
    const select = document.getElementById('department-filter');
    select.innerHTML = '<option value="">-- เลือกแผนก --</option>';
    depts.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        select.appendChild(option);
    });
}

// --- 5. Event Handling ---

/**
 * ตั้งค่า Event Listener ให้กับ Element ต่างๆ บนหน้าเว็บ
 */
function setupEventListeners() {
    document.getElementById('template-select').addEventListener('change', handleTemplateChange);
    document.getElementById('select-all-btn').addEventListener('click', selectAllEmployees);
    document.getElementById('select-by-dept-btn').addEventListener('click', toggleDepartmentFilter);
    document.getElementById('department-filter').addEventListener('change', selectByDepartment);
    document.getElementById('employee-list').addEventListener('change', updateSelectionSummary);
    document.getElementById('generate-cards-btn').addEventListener('click', generateCards);
}

function handleTemplateChange(e) {
    const templateId = e.target.value;
    const template = templates.find(t => t.id === templateId);
    const previewEl = document.getElementById('template-preview');
    const detailsEl = document.getElementById('template-details');

    if (template) {
        detailsEl.innerHTML = `
            <p><strong>ชื่อบริษัท:</strong> ${template.company_name || 'ไม่ระบุ'}</p>
            <p><strong>การวาง:</strong> ${template.orientation}</p>
        `;
        previewEl.style.display = 'block';
    } else {
        previewEl.style.display = 'none';
    }
    updateGenerateButton();
}

function selectAllEmployees() {
    const checkboxes = document.querySelectorAll('.employee-checkbox');
    // ตรวจสอบว่ามีช่องไหนที่ยังไม่ได้เลือกหรือไม่
    const isAnyUnchecked = Array.from(checkboxes).some(cb => !cb.checked);
    // ถ้ามีช่องที่ยังไม่ได้เลือก ให้เลือกทั้งหมด, ถ้าทุกช่องถูกเลือกแล้ว ให้เอาออกทั้งหมด
    checkboxes.forEach(cb => cb.checked = isAnyUnchecked);
    updateSelectionSummary();
}

function toggleDepartmentFilter() {
    const filter = document.getElementById('department-filter');
    filter.style.display = filter.style.display === 'none' ? 'inline-block' : 'none';
}

function selectByDepartment(e) {
    const selectedDept = e.target.value;
    if (!selectedDept) return;

    const checkboxes = document.querySelectorAll('.employee-checkbox');
    checkboxes.forEach(cb => {
        const employeeId = cb.dataset.employeeId;
        const employee = employees.find(emp => emp.id === employeeId);
        cb.checked = employee && employee.department_name === selectedDept;
    });
    updateSelectionSummary();
}

function updateSelectionSummary() {
    const checkedBoxes = document.querySelectorAll('.employee-checkbox:checked');
    selectedEmployeeIds = Array.from(checkedBoxes).map(cb => cb.dataset.employeeId);
    
    document.getElementById('selection-summary').textContent = `เลือกแล้ว: ${selectedEmployeeIds.length} คน`;
    updateGenerateButton();
}

function updateGenerateButton() {
    const btn = document.getElementById('generate-cards-btn');
    const hasTemplate = !!document.getElementById('template-select').value;
    const hasEmployees = selectedEmployeeIds.length > 0;
    
    btn.disabled = !hasTemplate || !hasEmployees;
    btn.textContent = hasEmployees 
        ? `🚀 สร้างบัตรพนักงาน (${selectedEmployeeIds.length} คน)` 
        : '🚀 สร้างบัตรพนักงาน';
}


// --- 6. Core Logic ---

/**
 * รวบรวมข้อมูลทั้งหมดและส่งไปให้ Netlify Function เพื่อสร้าง PDF
 */
async function generateCards() {
    const templateId = document.getElementById('template-select').value;
    if (!templateId) {
        alert('กรุณาเลือก Template');
        return;
    }
    if (selectedEmployeeIds.length === 0) {
        alert('กรุณาเลือกพนักงานอย่างน้อย 1 คน');
        return;
    }

    // รวบรวมค่า Settings
    const printSettings = {
        layout: document.querySelector('input[name="print-layout"]:checked').value,
        include_cropmarks: document.getElementById('include-cropmarks').checked,
        double_sided: document.getElementById('double-sided').checked
    };

    // แสดง Progress bar
    const btn = document.getElementById('generate-cards-btn');
    const progressSection = document.getElementById('progress-section');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const downloadSection = document.getElementById('download-section');
    
    btn.disabled = true;
    progressSection.style.display = 'block';
    downloadSection.style.display = 'none';
    progressFill.style.width = '0%';
    progressText.textContent = 'กำลังเตรียมข้อมูล...';

    try {
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        if (sessionError || !session) throw new Error('ไม่สามารถยืนยันตัวตนได้ กรุณาล็อกอินใหม่');

        progressFill.style.width = '20%';
        progressText.textContent = 'กำลังสร้างไฟล์ PDF บน Server... (ขั้นตอนนี้อาจใช้เวลาสักครู่)';
        
        const response = await fetch('/.netlify/functions/generate-bulk-cards', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                template_id: templateId,
                employee_ids: selectedEmployeeIds,
                print_settings: printSettings
            })
        });
        
        progressFill.style.width = '80%';
        progressText.textContent = 'กำลังรับไฟล์...';

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'เกิดข้อผิดพลาดในการสร้างไฟล์ PDF');
        }

        progressFill.style.width = '100%';
        progressText.textContent = 'สร้างไฟล์สำเร็จ!';
        
        showDownloadLink(result);

    } catch (error) {
        console.error('Generate cards error:', error);
        progressText.textContent = `เกิดข้อผิดพลาด: ${error.message}`;
        progressFill.style.backgroundColor = '#dc2626'; // Red
        alert(`เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
        setTimeout(() => {
            btn.disabled = false;
            progressSection.style.display = 'none';
            progressFill.style.width = '0%';
            progressFill.style.backgroundColor = 'var(--secondary-color)'; // Reset to green
        }, 3000);
    }
}

/**
 * แสดง Link สำหรับดาวน์โหลด PDF
 */
function showDownloadLink(result) {
    const section = document.getElementById('download-section');
    const linksEl = document.getElementById('download-links');
    
    linksEl.innerHTML = `
        <div style="text-align: center; padding: 20px; border: 2px dashed var(--secondary-color); border-radius: 8px;">
            <h3>✅ สร้างไฟล์ PDF สำเร็จ!</h3>
            <p>จำนวนบัตร: <strong>${result.cards_generated || 0}</strong> ใบ</p>
            <a href="${result.pdfData}" download="employee-cards.pdf" 
               style="display: inline-block; background: var(--secondary-color); color: white; padding: 15px 30px; 
                      text-decoration: none; border-radius: 8px; font-weight: bold; margin: 10px;">
                📥 ดาวน์โหลด PDF
            </a>
        </div>
    `;
    section.style.display = 'block';
}