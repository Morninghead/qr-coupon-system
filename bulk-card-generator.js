// Global variables
let supabase;
let currentUser = null;
let previewedEmployees = [];

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Bulk Card Generator initializing...');
    
    try {
        // Initialize Supabase
        const config = await getSupabaseConfig();
        supabase = window.supabase.createClient(config.url, config.key);
        console.log('Supabase client initialized.');
        
        // Initialize Netlify Identity
        if (typeof netlifyIdentity !== 'undefined') {
            netlifyIdentity.init();
            
            // Check current user
            currentUser = netlifyIdentity.currentUser();
            if (currentUser) {
                console.log('User already logged in:', currentUser.email);
                await initializeApp();
            } else {
                showLoginRequired();
            }
            
            // Handle login events
            netlifyIdentity.on('login', async (user) => {
                currentUser = user;
                console.log('User logged in:', user.email);
                await initializeApp();
            });
            
            netlifyIdentity.on('logout', () => {
                currentUser = null;
                console.log('User logged out');
                showLoginRequired();
            });
        } else {
            console.error('Netlify Identity not loaded');
            showError('ระบบ authentication ไม่พร้อมใช้งาน');
        }
        
    } catch (error) {
        console.error('Initialization error:', error);
        showError('เกิดข้อผิดพลาดในการเริ่มต้นระบบ: ' + error.message);
    }
});

// Get Supabase configuration
async function getSupabaseConfig() {
    try {
        const response = await fetch('/.netlify/functions/get-config');
        const config = await response.json();
        
        if (!config.url || !config.key) {
            throw new Error('Invalid Supabase configuration');
        }
        
        return config;
    } catch (error) {
        console.error('Failed to get Supabase config:', error);
        throw new Error('ไม่สามารถเชื่อมต่อกับฐานข้อมูลได้');
    }
}

// Initialize application after login
async function initializeApp() {
    try {
        showLoading(false);
        hideError();
        
        // Load data
        await Promise.all([
            loadTemplates(),
            loadDepartments(),
            loadPositions()
        ]);
        
        // Setup event listeners
        setupEventListeners();
        
        console.log('Bulk Card Generator initialized successfully.');
        
    } catch (error) {
        console.error('App initialization error:', error);
        showError('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + error.message);
    }
}

// Setup event listeners
function setupEventListeners() {
    const previewButton = document.getElementById('previewButton');
    const generateButton = document.getElementById('generateButton');
    const form = document.getElementById('bulkGeneratorForm');
    const tempEmployeeFilter = document.getElementById('tempEmployeeFilter');
    const permanentEmployeeFilter = document.getElementById('permanentEmployeeFilter');
    
    // Preview button
    previewButton.addEventListener('click', previewEmployees);
    
    // Form submission
    form.addEventListener('submit', generateCards);
    
    // Template selection change
    document.getElementById('templateSelect').addEventListener('change', (e) => {
        const generateBtn = document.getElementById('generateButton');
        generateBtn.disabled = !e.target.value;
    });
    
    // Checkbox mutual exclusion
    tempEmployeeFilter.addEventListener('change', (e) => {
        if (e.target.checked) {
            permanentEmployeeFilter.checked = false;
        }
    });
    
    permanentEmployeeFilter.addEventListener('change', (e) => {
        if (e.target.checked) {
            tempEmployeeFilter.checked = false;
        }
    });
    
    // Filter change events
    ['departmentFilter', 'positionFilter', 'tempEmployeeFilter', 'permanentEmployeeFilter', 'startDate', 'endDate'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            // Reset preview when filters change
            hideEmployeeCount();
            document.getElementById('generateButton').disabled = !document.getElementById('templateSelect').value;
        });
    });
}

// Load templates
async function loadTemplates() {
    try {
        const response = await fetch('/.netlify/functions/get-card-templates', {
            headers: {
                'Authorization': `Bearer ${currentUser.token.access_token}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.success && result.templates) {
            const templateSelect = document.getElementById('templateSelect');
            templateSelect.innerHTML = '<option value="">กรุณาเลือก Template</option>';
            
            result.templates.forEach(template => {
                const option = document.createElement('option');
                option.value = template.id;
                option.textContent = template.name;
                templateSelect.appendChild(option);
            });
            
            console.log(`Loaded ${result.templates.length} templates`);
        } else {
            throw new Error(result.error || 'ไม่สามารถโหลด templates ได้');
        }
    } catch (error) {
        console.error('Error loading templates:', error);
        showError('ไม่สามารถโหลด templates ได้: ' + error.message);
    }
}

// Load departments
async function loadDepartments() {
    try {
        const response = await fetch('/.netlify/functions/get-departments', {
            headers: {
                'Authorization': `Bearer ${currentUser.token.access_token}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.success && result.departments) {
            const departmentSelect = document.getElementById('departmentFilter');
            
            result.departments.forEach(dept => {
                const option = document.createElement('option');
                option.value = dept;
                option.textContent = dept;
                departmentSelect.appendChild(option);
            });
            
            console.log(`Loaded ${result.departments.length} departments`);
        }
    } catch (error) {
        console.error('Error loading departments:', error);
        // Don't show error for departments as it's not critical
    }
}

// Load positions
async function loadPositions() {
    try {
        const response = await fetch('/.netlify/functions/get-employees', {
            headers: {
                'Authorization': `Bearer ${currentUser.token.access_token}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.success && result.employees) {
            // Extract unique positions
            const positions = [...new Set(result.employees.map(emp => emp.position).filter(Boolean))];
            const positionSelect = document.getElementById('positionFilter');
            
            positions.forEach(position => {
                const option = document.createElement('option');
                option.value = position;
                option.textContent = position;
                positionSelect.appendChild(option);
            });
            
            console.log(`Loaded ${positions.length} positions`);
        }
    } catch (error) {
        console.error('Error loading positions:', error);
        // Don't show error for positions as it's not critical
    }
}

// Preview employees based on filters
async function previewEmployees() {
    try {
        showLoading(true);
        hideError();
        
        const filterCriteria = getFilterCriteria();
        console.log('Preview filter criteria:', filterCriteria);
        
        const response = await fetch('/.netlify/functions/get-employees', {
            headers: {
                'Authorization': `Bearer ${currentUser.token.access_token}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.success && result.employees) {
            // Filter employees locally
            previewedEmployees = filterEmployees(result.employees, filterCriteria);
            
            displayEmployeeCount(previewedEmployees);
            
            // Enable generate button if template is selected and employees found
            const templateSelected = document.getElementById('templateSelect').value;
            document.getElementById('generateButton').disabled = !templateSelected || previewedEmployees.length === 0;
            
        } else {
            throw new Error(result.error || 'ไม่สามารถโหลดข้อมูลพนักงานได้');
        }
        
    } catch (error) {
        console.error('Preview error:', error);
        showError('ไม่สามารถแสดงตัวอย่างข้อมูลได้: ' + error.message);
        hideEmployeeCount();
    } finally {
        showLoading(false);
    }
}

// Get filter criteria from form
function getFilterCriteria() {
    const department = document.getElementById('departmentFilter').value;
    const position = document.getElementById('positionFilter').value;
    const tempEmployee = document.getElementById('tempEmployeeFilter').checked;
    const permanentEmployee = document.getElementById('permanentEmployeeFilter').checked;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    const criteria = {};
    
    if (department && department !== 'all') {
        criteria.department = department;
    }
    
    if (position && position !== 'all') {
        criteria.position = position;
    }
    
    if (tempEmployee) {
        criteria.is_temp_employee = true;
    } else if (permanentEmployee) {
        criteria.is_temp_employee = false;
    }
    
    if (startDate || endDate) {
        criteria.dateRange = {};
        if (startDate) criteria.dateRange.start = startDate;
        if (endDate) criteria.dateRange.end = endDate;
    }
    
    return criteria;
}

// Filter employees based on criteria
function filterEmployees(employees, criteria) {
    return employees.filter(employee => {
        // Department filter
        if (criteria.department && employee.department !== criteria.department) {
            return false;
        }
        
        // Position filter
        if (criteria.position && employee.position !== criteria.position) {
            return false;
        }
        
        // Employee type filter
        if (criteria.is_temp_employee !== undefined && employee.is_temp_employee !== criteria.is_temp_employee) {
            return false;
        }
        
        // Date range filter
        if (criteria.dateRange) {
            const createdDate = new Date(employee.created_at);
            
            if (criteria.dateRange.start) {
                const startDate = new Date(criteria.dateRange.start);
                if (createdDate < startDate) return false;
            }
            
            if (criteria.dateRange.end) {
                const endDate = new Date(criteria.dateRange.end);
                endDate.setHours(23, 59, 59, 999); // End of day
                if (createdDate > endDate) return false;
            }
        }
        
        return true;
    });
}

// Display employee count and preview
function displayEmployeeCount(employees) {
    const countElement = document.getElementById('employeeCount');
    const countText = document.getElementById('countText');
    const previewElement = document.getElementById('employeePreview');
    
    countText.textContent = employees.length;
    
    if (employees.length > 0) {
        // Show preview of first few employees
        const previewList = employees.slice(0, 5).map(emp => 
            `${emp.employee_id}: ${emp.first_name} ${emp.last_name} (${emp.department})`
        ).join('<br>');
        
        previewElement.innerHTML = `
            <div style="margin-top: 10px; font-size: 12px; color: #666;">
                <strong>ตัวอย่างพนักงาน (${Math.min(5, employees.length)} คนแรก):</strong><br>
                ${previewList}
                ${employees.length > 5 ? '<br>และอีก ' + (employees.length - 5) + ' คน...' : ''}
            </div>
        `;
        
        countElement.style.display = 'block';
    } else {
        previewElement.innerHTML = '<div style="margin-top: 10px; color: #dc3545;">ไม่พบพนักงานที่ตรงกับเงื่อนไข</div>';
        countElement.style.display = 'block';
    }
}

// Hide employee count
function hideEmployeeCount() {
    document.getElementById('employeeCount').style.display = 'none';
    previewedEmployees = [];
}

// Generate cards
async function generateCards(event) {
    event.preventDefault();
    
    try {
        // Validate form
        if (!validateForm()) {
            return;
        }
        
        showLoading(true);
        hideError();
        hideSuccess();
        
        const templateId = document.getElementById('templateSelect').value;
        const filterCriteria = getFilterCriteria();
        
        console.log('Generating cards with:', { templateId, filterCriteria });
        
        // Use previewed employees if available, otherwise get fresh data
        let employeeIds;
        if (previewedEmployees.length > 0) {
            employeeIds = previewedEmployees.map(emp => emp.id);
        } else {
            // If no preview, we need to get employees first
            const response = await fetch('/.netlify/functions/get-employees', {
                headers: {
                    'Authorization': `Bearer ${currentUser.token.access_token}`
                }
            });
            
            const result = await response.json();
            if (!result.success) {
                throw new Error('ไม่สามารถโหลดข้อมูลพนักงานได้');
            }
            
            const filteredEmployees = filterEmployees(result.employees, filterCriteria);
            employeeIds = filteredEmployees.map(emp => emp.id);
        }
        
        if (employeeIds.length === 0) {
            throw new Error('ไม่พบพนักงานที่ตรงกับเงื่อนไขที่กำหนด');
        }
        
        if (employeeIds.length > 200) {
            throw new Error('จำนวนพนักงานมากเกินไป (เกิน 200 คน) กรุณาใช้เงื่อนไขที่จำกัดมากขึ้น');
        }
        
        const requestBody = {
            templateId: templateId,
            filterCriteria: {
                ...filterCriteria,
                employeeIds: employeeIds
            }
        };
        
        console.log('Request body:', requestBody);
        
        const response = await fetch('/.netlify/functions/generate-bulk-cards', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUser.token.access_token}`
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            // Download PDF
            const link = document.createElement('a');
            link.href = `data:application/pdf;base64,${result.pdf}`;
            link.download = result.filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showSuccess(`สร้างบัตรสำเร็จ จำนวน ${result.cardCount} บัตร`);
            console.log('Cards generated successfully:', result);
            
        } else {
            throw new Error(result.error || 'Unknown error occurred');
        }
        
    } catch (error) {
        console.error('Generate cards error:', error);
        showError(`เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

// Validate form before submission
function validateForm() {
    const templateId = document.getElementById('templateSelect').value;
    
    if (!templateId) {
        showError('กรุณาเลือก Template บัตร');
        return false;
    }
    
    if (!currentUser) {
        showError('กรุณาเข้าสู่ระบบก่อน');
        return false;
    }
    
    // Check if preview was done
    if (previewedEmployees.length === 0) {
        showError('กรุณาดูตัวอย่างข้อมูลพนักงานก่อนสร้างบัตร');
        return false;
    }
    
    return true;
}

// Show login required message
function showLoginRequired() {
    const container = document.querySelector('.container');
    container.innerHTML = `
        <div style="text-align: center; padding: 50px;">
            <h2>กรุณาเข้าสู่ระบบ</h2>
            <p>คุณต้องเข้าสู่ระบบก่อนใช้งาน Bulk Card Generator</p>
            <button onclick="netlifyIdentity.open()" class="btn btn-primary">เข้าสู่ระบบ</button>
        </div>
    `;
}

// Utility functions
function showLoading(show) {
    const loading = document.getElementById('loadingIndicator');
    const generateButton = document.getElementById('generateButton');
    const previewButton = document.getElementById('previewButton');
    
    if (show) {
        loading.style.display = 'block';
        generateButton.disabled = true;
        previewButton.disabled = true;
        generateButton.textContent = 'กำลังสร้าง...';
    } else {
        loading.style.display = 'none';
        previewButton.disabled = false;
        generateButton.textContent = 'สร้างบัตรพนักงาน';
        
        // Re-enable generate button only if conditions are met
        const templateSelected = document.getElementById('templateSelect').value;
        generateButton.disabled = !templateSelected || previewedEmployees.length === 0;
    }
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    console.error('Error:', message);
}

function hideError() {
    document.getElementById('errorMessage').style.display = 'none';
}

function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    
    // Auto hide after 5 seconds
    setTimeout(() => {
        hideSuccess();
    }, 5000);
}

function hideSuccess() {
    document.getElementById('successMessage').style.display = 'none';
}

// Debug function (for development)
function debug() {
    console.log('Debug Info:', {
        currentUser: currentUser,
        templateSelected: document.getElementById('templateSelect').value,
        filterCriteria: getFilterCriteria(),
        previewedEmployees: previewedEmployees.length
    });
}

// Make debug available globally
window.debug = debug;
