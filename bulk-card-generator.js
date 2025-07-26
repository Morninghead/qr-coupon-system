let supabaseClient = null;
let templates = [];
let employees = [];
let selectedEmployees = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // ตรวจสอบว่า Supabase โหลดแล้วหรือยัง
    if (typeof Supabase === 'undefined') {
        console.error('Supabase not loaded');
        alert('ไม่สามารถโหลด Supabase ได้ กรุณาโหลดหน้าใหม่');
        return;
    }

    try {
        await initializeSupabase();
        await loadTemplates();  
        await loadEmployees();
        setupEventListeners();
    } catch (error) {
        console.error('Initialization failed:', error);
        alert('ไม่สามารถเริ่มต้นระบบได้: ' + error.message);
    }
});

async function initializeSupabase() {
    try {
        const response = await fetch('/.netlify/functions/get-config');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const config = await response.json();
        
        if (!config.supabaseUrl || !config.supabaseAnonKey) {
            throw new Error('Invalid Supabase configuration');
        }
        
        // ตรวจสอบว่า Supabase global variable พร้อมใช้งาน
        if (typeof Supabase === 'undefined') {
            throw new Error('Supabase library not loaded');
        }
        
        supabaseClient = Supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        console.log('Supabase initialized successfully');
        
    } catch (error) {
        console.error('Failed to initialize Supabase:', error);
        throw error;
    }
}

async function loadTemplates() {
    if (!supabaseClient) {
        throw new Error('Supabase client not initialized');
    }

    try {
        const { data, error } = await supabaseClient
            .from('card_templates')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        templates = data || [];
        populateTemplateSelect();
        console.log(`Loaded ${templates.length} templates`);
        
    } catch (error) {
        console.error('Failed to load templates:', error);
        
        // แสดง error ใน UI
        const select = document.getElementById('template-select');
        if (select) {
            select.innerHTML = '<option value="">ไม่สามารถโหลด templates ได้ - ตรวจสอบการเชื่อมต่อ</option>';
        }
        
        throw error;
    }
}

function populateTemplateSelect() {
    const select = document.getElementById('template-select');
    if (!select) return;
    
    if (templates.length === 0) {
        select.innerHTML = '<option value="">ไม่พบ templates - กรุณาสร้าง template ก่อน</option>';
        return;
    }
    
    select.innerHTML = '<option value="">เลือก Template...</option>';
    
    templates.forEach(template => {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = `${template.template_name} (${template.company_name || 'ไม่ระบุบริษัท'})`;
        select.appendChild(option);
    });
}

async function loadEmployees() {
    if (!supabaseClient) {
        throw new Error('Supabase client not initialized');
    }

    try {
        const { data, error } = await supabaseClient
            .from('employees')
            .select('*')
            .order('full_name');

        if (error) throw error;

        employees = data || [];
        populateEmployeeList();
        loadDepartments();
        console.log(`Loaded ${employees.length} employees`);
        
    } catch (error) {
        console.error('Failed to load employees:', error);
        
        // แสดง error ใน UI
        const listEl = document.getElementById('employee-list');
        if (listEl) {
            listEl.innerHTML = '<p style="color: red;">ไม่สามารถโหลดรายชื่อพนักงานได้ - ตรวจสอบการเชื่อมต่อ</p>';
        }
        
        throw error;
    }
}

function populateEmployeeList() {
    const listEl = document.getElementById('employee-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';

    if (employees.length === 0) {
        listEl.innerHTML = '<p>ไม่พบข้อมูลพนักงาน กรุณาเพิ่มพนักงานก่อน</p>';
        return;
    }

    employees.forEach(employee => {
        const item = document.createElement('div');
        item.className = 'employee-item';
        item.innerHTML = `
            <input type="checkbox" id="emp-${employee.id}" data-employee-id="${employee.id}">
            <label for="emp-${employee.id}" style="margin-left: 8px;">
                ${employee.full_name} (${employee.employee_id}) - ${employee.department || 'ไม่ระบุแผนก'}
            </label>
        `;
        listEl.appendChild(item);
    });
}

function loadDepartments() {
    const depts = [...new Set(employees.map(emp => emp.department).filter(Boolean))];
    const select = document.getElementById('department-filter');
    if (!select) return;
    
    // Clear existing options except first one
    select.innerHTML = '<option value="">เลือกแผนก...</option>';
    
    depts.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        select.appendChild(option);
    });
}

function setupEventListeners() {
    // Template selection
    const templateSelect = document.getElementById('template-select');
    if (templateSelect) {
        templateSelect.addEventListener('change', handleTemplateChange);
    }
    
    // Employee selection
    const selectAllBtn = document.getElementById('select-all-btn');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', selectAllEmployees);
    }
    
    const selectByDeptBtn = document.getElementById('select-by-dept-btn');
    if (selectByDeptBtn) {
        selectByDeptBtn.addEventListener('click', toggleDepartmentFilter);
    }
    
    const deptFilter = document.getElementById('department-filter');
    if (deptFilter) {
        deptFilter.addEventListener('change', selectByDepartment);
    }
    
    // Employee checkboxes
    const employeeList = document.getElementById('employee-list');
    if (employeeList) {
        employeeList.addEventListener('change', updateSelectionSummary);
    }
    
    // Generate button
    const generateBtn = document.getElementById('generate-cards-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', generateCards);
    }
}

function handleTemplateChange(e) {
    const templateId = e.target.value;
    const template = templates.find(t => t.id == templateId);
    
    if (template) {
        showTemplatePreview(template);
        updateGenerateButton();
    } else {
        hideTemplatePreview();
    }
}

function showTemplatePreview(template) {
    const previewEl = document.getElementById('template-preview');
    const detailsEl = document.getElementById('template-details');
    
    if (previewEl && detailsEl) {
        detailsEl.innerHTML = `
            <p><strong>ชื่อ:</strong> ${template.template_name}</p>
            <p><strong>บริษัท:</strong> ${template.company_name || 'ไม่ระบุ'}</p>
            <p><strong>แนวตั้ง/นอน:</strong> ${template.orientation}</p>
            <p><strong>สร้างเมื่อ:</strong> ${new Date(template.created_at).toLocaleDateString('th-TH')}</p>
        `;
        
        previewEl.style.display = 'block';
    }
}

function hideTemplatePreview() {
    const previewEl = document.getElementById('template-preview');
    if (previewEl) {
        previewEl.style.display = 'none';
    }
}

function selectAllEmployees() {
    const checkboxes = document.querySelectorAll('#employee-list input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    
    checkboxes.forEach(cb => cb.checked = !allChecked);
    updateSelectionSummary();
}

function toggleDepartmentFilter() {
    const filter = document.getElementById('department-filter');
    if (filter) {
        filter.style.display = filter.style.display === 'none' ? 'block' : 'none';
    }
}

function selectByDepartment() {
    const selectedDept = document.getElementById('department-filter')?.value;
    if (!selectedDept) return;
    
    const checkboxes = document.querySelectorAll('#employee-list input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const employeeId = cb.dataset.employeeId;
        const employee = employees.find(emp => emp.id == employeeId);
        cb.checked = employee && employee.department === selectedDept;
    });
    
    updateSelectionSummary();
}

function updateSelectionSummary() {
    const checkedBoxes = document.querySelectorAll('#employee-list input[type="checkbox"]:checked');
    selectedEmployees = Array.from(checkedBoxes).map(cb => cb.dataset.employeeId);
    
    const summaryEl = document.getElementById('selection-summary');
    if (summaryEl) {
        summaryEl.textContent = `เลือกแล้ว: ${selectedEmployees.length} คน`;
    }
    
    updateGenerateButton();
}

function updateGenerateButton() {
    const btn = document.getElementById('generate-cards-btn');
    if (!btn) return;
    
    const hasTemplate = document.getElementById('template-select')?.value;
    const hasEmployees = selectedEmployees.length > 0;
    
    btn.disabled = !hasTemplate || !hasEmployees;
    
    if (hasTemplate && hasEmployees) {
        btn.textContent = `🚀 สร้างบัตรพนักงาน (${selectedEmployees.length} คน)`;
    } else {
        btn.textContent = '🚀 สร้างบัตรพนักงาน';
    }
}

async function generateCards() {
    if (!supabaseClient) {
        alert('ระบบยังไม่พร้อมใช้งาน กรุณาโหลดหน้าใหม่');
        return;
    }

    const templateSelect = document.getElementById('template-select');
    const templateId = templateSelect?.value;
    
    if (!templateId) {
        alert('กรุณาเลือก Template');
        return;
    }
    
    if (selectedEmployees.length === 0) {
        alert('กรุณาเลือกพนักงาน');
        return;
    }
    
    const printLayout = document.querySelector('input[name="print-layout"]:checked')?.value || 'A4-8cards';
    const includeCropmarks = document.getElementById('include-cropmarks')?.checked || false;
    const doubleSided = document.getElementById('double-sided')?.checked || false;
    
    const btn = document.getElementById('generate-cards-btn');
    const progressSection = document.getElementById('progress-section');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    // Show progress
    if (btn) btn.disabled = true;
    if (progressSection) progressSection.style.display = 'block';
    if (progressText) progressText.textContent = 'กำลังเตรียมข้อมูล...';
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        if (!session) {
            throw new Error('กรุณาล็อกอินก่อนใช้งาน');
        }
        
        if (progressFill) progressFill.style.width = '20%';
        if (progressText) progressText.textContent = 'กำลังสร้าง PDF...';
        
        const response = await fetch('/.netlify/functions/generate-bulk-cards', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                template_id: templateId,
                employee_ids: selectedEmployees,
                print_settings: {
                    layout: printLayout,
                    include_cropmarks: includeCropmarks,
                    double_sided: doubleSided
                }
            })
        });
        
        if (progressFill) progressFill.style.width = '80%';
        if (progressText) progressText.textContent = 'กำลังอัปโหลดไฟล์...';
        
        const result = await response.json();
        
        if (response.ok) {
            if (progressFill) progressFill.style.width = '100%';
            if (progressText) progressText.textContent = 'เสร็จสิ้น!';
            
            setTimeout(() => {
                showDownloadSection(result);
                alert(`สร้างบัตรเรียบร้อยแล้ว! จำนวน ${result.cards_generated} ใบ`);
            }, 500);
        } else {
            throw new Error(result.error || 'ไม่สามารถสร้างบัตรได้');
        }
        
    } catch (error) {
        console.error('Generate error:', error);
        alert('เกิดข้อผิดพลาด: ' + error.message);
    } finally {
        setTimeout(() => {
            if (btn) btn.disabled = false;
            if (progressSection) progressSection.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
        }, 1000);
    }
}

function showDownloadSection(result) {
    const section = document.getElementById('download-section');
    const linksEl = document.getElementById('download-links');
    
    if (section && linksEl) {
        linksEl.innerHTML = `
            <div style="text-align: center; padding: 20px; border: 2px dashed #10B981; border-radius: 8px;">
                <h3>✅ สร้างเสร็จแล้ว!</h3>
                <p>จำนวนบัตร: <strong>${result.cards_generated}</strong> ใบ</p>
                <a href="${result.pdf_url}" download="${result.file_name}" 
                   style="display: inline-block; background: #10B981; color: white; padding: 15px 30px; 
                          text-decoration: none; border-radius: 8px; font-weight: bold; margin: 10px;">
                    📥 ดาวน์โหลด PDF
                </a>
            </div>
            <div style="margin-top: 15px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                <h4>📝 คำแนะนำการพิมพ์:</h4>
                <ul>
                    <li>ใช้กระดาษหนา 300-350 แกรม เพื่อความคล้ายคลึงกับบัตรจริง</li>
                    <li>ตั้งค่า printer เป็น "Actual Size" หรือ "100%"</li>
                    <li>ใช้เครื่องตัดกระดาษตัดตามเส้นประ</li>
                    <li>เจาะรูด้วยเครื่องเจาะสำหรับสายคล้อง</li>
                </ul>
            </div>
        `;
        
        section.style.display = 'block';
    }
}
