let supabaseClient = null;
let templates = [];
let employees = [];
let selectedEmployees = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await initializeSupabase();
    await loadTemplates();
    await loadEmployees();
    setupEventListeners();
});

async function initializeSupabase() {
    try {
        const response = await fetch('/.netlify/functions/get-config');
        const config = await response.json();
        supabaseClient = Supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    } catch (error) {
        console.error('Failed to initialize Supabase:', error);
    }
}

async function loadTemplates() {
    try {
        const { data, error } = await supabaseClient
            .from('card_templates')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        templates = data;
        populateTemplateSelect();
    } catch (error) {
        console.error('Failed to load templates:', error);
        document.getElementById('template-select').innerHTML = '<option value="">ไม่พบ templates - กรุณาสร้าง template ก่อน</option>';
    }
}

function populateTemplateSelect() {
    const select = document.getElementById('template-select');
    select.innerHTML = '<option value="">เลือก Template...</option>';
    
    templates.forEach(template => {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = `${template.template_name} (${template.company_name || 'ไม่ระบุบริษัท'})`;
        select.appendChild(option);
    });
}

async function loadEmployees() {
    try {
        const { data, error } = await supabaseClient
            .from('employees')
            .select('*')
            .order('full_name');

        if (error) throw error;

        employees = data;
        populateEmployeeList();
        loadDepartments();
    } catch (error) {
        console.error('Failed to load employees:', error);
        document.getElementById('employee-list').innerHTML = 'ไม่สามารถโหลดรายชื่อพนักงานได้';
    }
}

function populateEmployeeList() {
    const listEl = document.getElementById('employee-list');
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
    
    depts.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        select.appendChild(option);
    });
}

function setupEventListeners() {
    // Template selection
    document.getElementById('template-select').addEventListener('change', handleTemplateChange);
    
    // Employee selection
    document.getElementById('select-all-btn').addEventListener('click', selectAllEmployees);
    document.getElementById('select-by-dept-btn').addEventListener('click', toggleDepartmentFilter);
    document.getElementById('department-filter').addEventListener('change', selectByDepartment);
    
    // Employee checkboxes
    document.getElementById('employee-list').addEventListener('change', updateSelectionSummary);
    
    // Generate button
    document.getElementById('generate-cards-btn').addEventListener('click', generateCards);
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
    
    detailsEl.innerHTML = `
        <p><strong>ชื่อ:</strong> ${template.template_name}</p>
        <p><strong>บริษัท:</strong> ${template.company_name || 'ไม่ระบุ'}</p>
        <p><strong>แนวตั้ง/นอน:</strong> ${template.orientation}</p>
        <p><strong>สร้างเมื่อ:</strong> ${new Date(template.created_at).toLocaleDateString('th-TH')}</p>
    `;
    
    previewEl.style.display = 'block';
}

function hideTemplatePreview() {
    document.getElementById('template-preview').style.display = 'none';
}

function selectAllEmployees() {
    const checkboxes = document.querySelectorAll('#employee-list input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    
    checkboxes.forEach(cb => cb.checked = !allChecked);
    updateSelectionSummary();
}

function toggleDepartmentFilter() {
    const filter = document.getElementById('department-filter');
    filter.style.display = filter.style.display === 'none' ? 'block' : 'none';
}

function selectByDepartment() {
    const selectedDept = document.getElementById('department-filter').value;
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
    
    document.getElementById('selection-summary').textContent = `เลือกแล้ว: ${selectedEmployees.length} คน`;
    updateGenerateButton();
}

function updateGenerateButton() {
    const btn = document.getElementById('generate-cards-btn');
    const hasTemplate = document.getElementById('template-select').value;
    const hasEmployees = selectedEmployees.length > 0;
    
    btn.disabled = !hasTemplate || !hasEmployees;
    
    if (hasTemplate && hasEmployees) {
        btn.textContent = `🚀 สร้างบัตรพนักงาน (${selectedEmployees.length} คน)`;
    } else {
        btn.textContent = '🚀 สร้างบัตรพนักงาน';
    }
}

async function generateCards() {
    const templateId = document.getElementById('template-select').value;
    const printLayout = document.querySelector('input[name="print-layout"]:checked').value;
    const includeCropmarks = document.getElementById('include-cropmarks').checked;
    const doubleSided = document.getElementById('double-sided').checked;
    
    const btn = document.getElementById('generate-cards-btn');
    const progressSection = document.getElementById('progress-section');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    // Show progress
    btn.disabled = true;
    progressSection.style.display = 'block';
    progressText.textContent = 'กำลังเตรียมข้อมูล...';
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        if (!session) {
            throw new Error('กรุณาล็อกอินก่อนใช้งาน');
        }
        
        progressFill.style.width = '20%';
        progressText.textContent = 'กำลังสร้าง PDF...';
        
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
        
        progressFill.style.width = '80%';
        progressText.textContent = 'กำลังอัปโหลดไฟล์...';
        
        const result = await response.json();
        
        if (response.ok) {
            progressFill.style.width = '100%';
            progressText.textContent = 'เสร็จสิ้น!';
            
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
            btn.disabled = false;
            progressSection.style.display = 'none';
            progressFill.style.width = '0%';
        }, 1000);
    }
}

function showDownloadSection(result) {
    const section = document.getElementById('download-section');
    const linksEl = document.getElementById('download-links');
    
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
