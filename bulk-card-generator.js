// Global variables
let supabase;
let currentUser = null;
let previewedEmployees = [];

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Bulk Card Generator initializing...');
    
    try {
        // Initialize Supabase first
        const config = await getSupabaseConfig();
        supabase = window.supabase.createClient(config.url, config.key);
        console.log('Supabase client initialized.');
        
        // Try to get user from multiple sources
        await initializeAuthentication();
        
    } catch (error) {
        console.error('Initialization error:', error);
        showError('เกิดข้อผิดพลาดในการเริ่มต้นระบบ: ' + error.message);
    }
});

// Enhanced authentication initialization
async function initializeAuthentication() {
    try {
        // Method 1: Check if user is already logged in from other pages
        const existingUser = await checkExistingSession();
        if (existingUser) {
            currentUser = existingUser;
            console.log('Found existing user session:', currentUser.email || currentUser.user?.email);
            await initializeApp();
            return;
        }

        // Method 2: Initialize Netlify Identity as fallback
        if (typeof netlifyIdentity !== 'undefined') {
            netlifyIdentity.init();
            
            // Check current user
            currentUser = netlifyIdentity.currentUser();
            if (currentUser) {
                console.log('User found via Netlify Identity:', currentUser.email);
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
        console.error('Authentication initialization error:', error);
        showError('เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์: ' + error.message);
    }
}

// Check for existing session from other pages
async function checkExistingSession() {
    try {
        // Method 1: Check localStorage for stored user data
        const storedUser = localStorage.getItem('supabase.auth.token');
        if (storedUser) {
            const parsedUser = JSON.parse(storedUser);
            if (parsedUser.access_token) {
                console.log('Found stored user token');
                
                // Verify token with Supabase
                const { data: { user }, error } = await supabase.auth.getUser(parsedUser.access_token);
                if (user && !error) {
                    return {
                        token: parsedUser,
                        user: user,
                        email: user.email
                    };
                }
            }
        }

        // Method 2: Check if there's a session in Supabase
        const { data: { session }, error } = await supabase.auth.getSession();
        if (session && session.user && !error) {
            console.log('Found Supabase session:', session.user.email);
            return {
                token: {
                    access_token: session.access_token,
                    refresh_token: session.refresh_token
                },
                user: session.user,
                email: session.user.email
            };
        }

        // Method 3: Check URL for auth tokens (from redirects)
        const urlParams = new URLSearchParams(window.location.search);
        const accessToken = urlParams.get('access_token');
        if (accessToken) {
            console.log('Found access token in URL');
            
            const { data: { user }, error } = await supabase.auth.getUser(accessToken);
            if (user && !error) {
                return {
                    token: { access_token: accessToken },
                    user: user,
                    email: user.email
                };
            }
        }

        // Method 4: Try to refresh session
        const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshedSession && refreshedSession.user && !refreshError) {
            console.log('Refreshed session successfully:', refreshedSession.user.email);
            return {
                token: {
                    access_token: refreshedSession.access_token,
                    refresh_token: refreshedSession.refresh_token
                },
                user: refreshedSession.user,
                email: refreshedSession.user.email
            };
        }

        return null;

    } catch (error) {
        console.error('Error checking existing session:', error);
        return null;
    }
}

// Get Supabase configuration
async function getSupabaseConfig() {
    try {
        const response = await fetch('/.netlify/functions/get-config');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const config = await response.json();
        
        console.log('Config received:', {
            hasUrl: !!config.url,
            hasKey: !!config.key,
            urlValid: config.url && config.url.includes('supabase.co'),
            keyValid: config.key && config.key.length > 50
        });
        
        if (!config.url || !config.key) {
            throw new Error('Invalid Supabase configuration: missing url or key');
        }
        
        if (!config.url.includes('supabase.co')) {
            throw new Error('Invalid Supabase URL format');
        }
        
        return config;
    } catch (error) {
        console.error('Failed to get Supabase config:', error);
        
        // Fallback: แสดงข้อความที่ชัดเจนกว่า
        if (error.message.includes('404')) {
            throw new Error('ไม่พบไฟล์ get-config function กรุณาตรวจสอบการ deploy');
        } else if (error.message.includes('500')) {
            throw new Error('ปัญหาการตั้งค่า Environment Variables ใน Netlify');
        } else {
            throw new Error('ไม่สามารถเชื่อมต่อกับฐานข้อมูลได้: ' + error.message);
        }
    }
}

// Initialize application after login
async function initializeApp() {
    try {
        showLoading(false);
        hideError();
        
        // Validate user has proper access token
        if (!currentUser || (!currentUser.token?.access_token && !currentUser.access_token)) {
            console.warn('No valid access token found, but continuing...');
        }

        console.log('Initializing app for user:', currentUser.email || currentUser.user?.email);
        
        // Load data
        await Promise.all([
            loadTemplates(),
            loadDepartments(),
            loadPositions()
        ]);
        
        // Setup event listeners
        setupEventListeners();
        
        // Hide login message and show main content
        const container = document.querySelector('.container');
        if (container && container.innerHTML.includes('กรุณาเข้าสู่ระบบ')) {
            location.reload(); // Reload to show proper content
        }
        
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
    
    if (!previewButton || !generateButton || !form) {
        console.error('Required elements not found');
        return;
    }
    
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
    if (tempEmployeeFilter && permanentEmployeeFilter) {
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
    }
    
    // Filter change events
    ['departmentFilter', 'positionFilter', 'tempEmployeeFilter', 'permanentEmployeeFilter', 'startDate', 'endDate'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => {
                // Reset preview when filters change
                hideEmployeeCount();
                document.getElementById('generateButton').disabled = !document.getElementById('templateSelect').value;
            });
        }
    });
}

// Enhanced loadTemplates with better token handling
async function loadTemplates() {
    try {
        const accessToken = getAccessToken();
        if (!accessToken) {
            console.warn('No access token for loadTemplates, attempting anyway...');
        }

        const response = await fetch('/.netlify/functions/get-card-templates', {
            headers: {
                'Authorization': `Bearer ${accessToken || 'no-token'}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.success && result.templates) {
            const templateSelect = document.getElementById('templateSelect');
            if (templateSelect) {
                templateSelect.innerHTML = '<option value="">กรุณาเลือก Template</option>';
                
                result.templates.forEach(template => {
                    const option = document.createElement('option');
                    option.value = template.id;
                    option.textContent = template.name;
                    templateSelect.appendChild(option);
                });
                
                console.log(`Loaded ${result.templates.length} templates`);
            }
        } else {
            throw new Error(result.error || 'ไม่สามารถโหลด templates ได้');
        }
    } catch (error) {
        console.error('Error loading templates:', error);
        if (error.message.includes('Session หมดอายุ')) {
            showLoginRequired();
        } else {
            showError('ไม่สามารถโหลด templates ได้: ' + error.message);
        }
    }
}

// Load departments
async function loadDepartments() {
    try {
        const accessToken = getAccessToken();
        
        const response = await fetch('/.netlify/functions/get-departments', {
            headers: {
                'Authorization': `Bearer ${accessToken || 'no-token'}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success && result.departments) {
                const departmentSelect = document.getElementById('departmentFilter');
                if (departmentSelect) {
                    result.departments.forEach(dept => {
                        const option = document.createElement('option');
                        option.value = dept;
                        option.textContent = dept;
                        departmentSelect.appendChild(option);
                    });
                    console.log(`Loaded ${result.departments.length} departments`);
                }
            }
        }
    } catch (error) {
        console.error('Error loading departments:', error);
        // Don't show error for departments as it's not critical
    }
}

// Load positions
async function loadPositions() {
    try {
        const accessToken = getAccessToken();
        
        const response = await fetch('/.netlify/functions/get-employees', {
            headers: {
                'Authorization': `Bearer ${accessToken || 'no-token'}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success && result.employees) {
                const positions = [...new Set(result.employees.map(emp => emp.position).filter(Boolean))];
                const positionSelect = document.getElementById('positionFilter');
                
                if (positionSelect) {
                    positions.forEach(position => {
                        const option = document.createElement('option');
                        option.value = position;
                        option.textContent = position;
                        positionSelect.appendChild(option);
                    });
                    
                    console.log(`Loaded ${positions.length} positions`);
                }
            }
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
        
        const accessToken = getAccessToken();
        const response = await fetch('/.netlify/functions/get-employees', {
            headers: {
                'Authorization': `Bearer ${accessToken || 'no-token'}`,
                'Content-Type': 'application/json'
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
    const department = document.getElementById('departmentFilter')?.value;
    const position = document.getElementById('positionFilter')?.value;
    const tempEmployee = document.getElementById('tempEmployeeFilter')?.checked;
    const permanentEmployee = document.getElementById('permanentEmployeeFilter')?.checked;
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    
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
    
    if (!countElement || !countText || !previewElement) {
        console.error('Preview elements not found');
        return;
    }
    
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
    const countElement = document.getElementById('employeeCount');
    if (countElement) {
        countElement.style.display = 'none';
    }
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
            const accessToken = getAccessToken();
            const response = await fetch('/.netlify/functions/get-employees', {
                headers: {
                    'Authorization': `Bearer ${accessToken || 'no-token'}`,
                    'Content-Type': 'application/json'
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
        
        const accessToken = getAccessToken();
        const response = await fetch('/.netlify/functions/generate-bulk-cards', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken || 'no-token'}`
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = { error: `HTTP ${response.status}: ${errorText}` };
            }
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
    const templateId = document.getElementById('templateSelect')?.value;
    
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

// Helper function to get access token from various sources
function getAccessToken() {
    if (currentUser) {
        // Try different token locations
        return currentUser.token?.access_token || 
               currentUser.access_token || 
               currentUser.user?.access_token;
    }
    return null;
}

// Show login required message with bypass option
function showLoginRequired() {
    const container = document.querySelector('.container');
    if (container) {
        container.innerHTML = `
            <div style="text-align: center; padding: 50px;">
                <h2>Authentication Required</h2>
                <p>ระบบตรวจไม่พบการ login ของคุณ</p>
                <div style="margin: 20px 0;">
                    <button onclick="netlifyIdentity.open()" class="btn btn-primary" style="margin-right: 10px; padding: 12px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        เข้าสู่ระบบ
                    </button>
                    <button onclick="bypassAuth()" class="btn btn-secondary" style="padding: 12px 20px; background-color: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        ผมเป็น Superuser อยู่แล้ว
                    </button>
                </div>
                <p style="font-size: 12px; color: #666; margin-top: 20px;">
                    หากคุณ login แล้วแต่ยังเห็นหน้านี้ ให้คลิก "ผมเป็น Superuser อยู่แล้ว"
                </p>
            </div>
        `;
    }
}

// Bypass authentication for superusers
window.bypassAuth = async function() {
    try {
        showLoading(true);
        console.log('Attempting to bypass authentication...');
        
        // Try to force refresh session
        if (supabase) {
            const { data: { session }, error } = await supabase.auth.getSession();
            if (session && session.user) {
                currentUser = {
                    token: {
                        access_token: session.access_token,
                        refresh_token: session.refresh_token
                    },
                    user: session.user,
                    email: session.user.email
                };
                
                console.log('Bypassed auth, found session:', currentUser.email);
                location.reload();
                return;
            }
        }

        // If no session, try to get stored token
        const storedAuth = localStorage.getItem('supabase.auth.token');
        if (storedAuth) {
            try {
                const parsedAuth = JSON.parse(storedAuth);
                currentUser = {
                    token: parsedAuth,
                    email: 'superuser@system.local'
                };
                
                console.log('Using stored auth for bypass');
                location.reload();
                return;
            } catch (parseError) {
                console.error('Error parsing stored auth:', parseError);
            }
        }

        // Last resort: create minimal user object for bypass
        currentUser = {
            token: { access_token: 'bypass-token' },
            email: 'superuser@system.local',
            bypass: true
        };
        
        console.log('Created bypass user object');
        await initializeApp();
        
    } catch (error) {
        console.error('Bypass auth error:', error);
        showError('ไม่สามารถ bypass authentication ได้: ' + error.message);
    } finally {
        showLoading(false);
    }
};

// Utility functions
function showLoading(show) {
    const loading = document.getElementById('loadingIndicator');
    const generateButton = document.getElementById('generateButton');
    const previewButton = document.getElementById('previewButton');
    
    if (loading) {
        loading.style.display = show ? 'block' : 'none';
    }
    
    if (generateButton && previewButton) {
        if (show) {
            generateButton.disabled = true;
            previewButton.disabled = true;
            generateButton.textContent = 'กำลังสร้าง...';
        } else {
            previewButton.disabled = false;
            generateButton.textContent = 'สร้างบัตรพนักงาน';
            
            // Re-enable generate button only if conditions are met
            const templateSelected = document.getElementById('templateSelect')?.value;
            generateButton.disabled = !templateSelected || previewedEmployees.length === 0;
        }
    }
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
    console.error('Error:', message);
}

function hideError() {
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
}

function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    if (successDiv) {
        successDiv.textContent = message;
        successDiv.style.display = 'block';
        
        // Auto hide after 5 seconds
        setTimeout(() => {
            hideSuccess();
        }, 5000);
    }
}

function hideSuccess() {
    const successDiv = document.getElementById('successMessage');
    if (successDiv) {
        successDiv.style.display = 'none';
    }
}

// Debug function (for development)
function debug() {
    console.log('Debug Info:', {
        currentUser: currentUser,
        templateSelected: document.getElementById('templateSelect')?.value,
        filterCriteria: getFilterCriteria(),
        previewedEmployees: previewedEmployees.length,
        supabaseInitialized: !!supabase,
        netlifyIdentityLoaded: typeof netlifyIdentity !== 'undefined'
    });
}

// Make debug available globally
window.debug = debug;

console.log('Bulk Card Generator script loaded successfully.');
