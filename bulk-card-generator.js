// --- 1. Global Variables ---
// These variables store data that is used across the page.
let supabaseClient = null;
let templates = [];
let employees = [];
let selectedEmployeeIds = [];

// --- 2. Main Initialization Trigger ---
// This is the key fix: It tells the browser to wait until the entire HTML document is ready
// before running the 'initializeApp' function. This prevents errors where the script
// tries to find HTML elements that haven't been created yet.
document.addEventListener('DOMContentLoaded', initializeApp);

/**
 * This is the main function that starts everything. It connects to Supabase,
 * loads the necessary data, and sets up all the interactive elements on the page.
 */
async function initializeApp() {
    const mainContent = document.getElementById('main-content');
    const loadingSection = document.getElementById('loading-section');
    
    // Hide the main content and show the loading spinner initially.
    mainContent.style.display = 'none';
    loadingSection.style.display = 'block';

    try {
        await initializeSupabase();
        
        // Load templates and employees at the same time for faster loading.
        await Promise.all([
            loadTemplates(),
            loadEmployees()
        ]);
        
        setupEventListeners();

        // Once everything is loaded, show the main content.
        mainContent.style.display = 'block';
        loadingSection.style.display = 'none';
        console.log('Bulk Card Generator initialized successfully.');

    } catch (error) {
        console.error('Initialization failed:', error);
        // If something goes wrong, display an error message on the page.
        mainContent.innerHTML = `<div style="color: red; text-align: center; padding: 40px;"><h3>⚠️ Could not initialize the system.</h3><p>${error.message}</p></div>`;
        mainContent.style.display = 'block';
        loadingSection.style.display = 'none';
    }
}

// --- 3. Supabase & Data Loading Functions ---

/**
 * Gets the configuration from a Netlify function and initializes the Supabase client.
 */
async function initializeSupabase() {
    try {
        const response = await fetch('/.netlify/functions/get-config');
        if (!response.ok) throw new Error(`Cannot get Supabase config: ${response.statusText}`);
        
        const config = await response.json();
        if (!config.supabaseUrl || !config.supabaseKey) {
            throw new Error('Invalid Supabase configuration received.');
        }
        
        // Create the Supabase client using the global 'supabase' object loaded in the HTML.
        supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseKey);
        console.log('Supabase client initialized.');

    } catch (error) {
        console.error('Failed to initialize Supabase:', error);
        throw error; // Pass the error up to the initializeApp function to handle.
    }
}

/**
 * Fetches all card templates from the Supabase database.
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
        document.getElementById('template-select').innerHTML = '<option value="">Error loading templates</option>';
    }
}

/**
 * Fetches all employees from the Supabase database.
 */
async function loadEmployees() {
    if (!supabaseClient) throw new Error('Supabase client not initialized.');

    try {
        const { data, error } = await supabaseClient
            .from('employees')
            .select('id, employee_id, name, department_name')
            .order('name', { ascending: true });

        if (error) throw error;
        employees = data || [];
        populateEmployeeList();
        populateDepartmentFilter();
        console.log(`Loaded ${employees.length} employees.`);
    } catch (error) {
        console.error('Failed to load employees:', error);
        document.getElementById('employee-list').innerHTML = '<p style="color: red;">Could not load employee list.</p>';
    }
}

// --- 4. UI Population Functions ---

/**
 * Adds the loaded templates to the template selection dropdown menu.
 */
function populateTemplateSelect() {
    const select = document.getElementById('template-select');
    if (templates.length === 0) {
        select.innerHTML = '<option value="">No templates found</option>';
        return;
    }
    select.innerHTML = '<option value="">-- Select a Template --</option>';
    templates.forEach(template => {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = `${template.template_name} (${template.company_name || 'N/A'})`;
        select.appendChild(option);
    });
}

/**
 * Displays the list of employees with a checkbox for each.
 */
function populateEmployeeList() {
    const listEl = document.getElementById('employee-list');
    listEl.innerHTML = '';

    if (employees.length === 0) {
        listEl.innerHTML = '<p>No employee data found.</p>';
        return;
    }

    employees.forEach(employee => {
        const item = document.createElement('div');
        item.className = 'employee-item';
        item.innerHTML = `
            <input type="checkbox" id="emp-${employee.id}" data-employee-id="${employee.id}" class="employee-checkbox">
            <label for="emp-${employee.id}" style="margin-left: 8px; cursor: pointer;">
                ${employee.name} (${employee.employee_id}) - ${employee.department_name || 'No Department'}
            </label>
        `;
        listEl.appendChild(item);
    });
}

/**
 * Creates the department filter dropdown based on the loaded employee data.
 */
function populateDepartmentFilter() {
    const depts = [...new Set(employees.map(emp => emp.department_name).filter(Boolean))];
    depts.sort();
    const select = document.getElementById('department-filter');
    select.innerHTML = '<option value="">-- Select a Department --</option>';
    depts.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        select.appendChild(option);
    });
}

// --- 5. Event Handling ---

/**
 * Sets up all the click and change event listeners for the page's interactive elements.
 */
function setupEventListeners() {
    document.getElementById('template-select').addEventListener('change', handleTemplateChange);
    document.getElementById('select-all-btn').addEventListener('click', selectAllEmployees);
    document.getElementById('select-by-dept-btn').addEventListener('click', toggleDepartmentFilter);
    document.getElementById('department-filter').addEventListener('change', selectByDepartment);
    document.getElementById('employee-list').addEventListener('change', updateSelectionSummary);
    document.getElementById('generate-cards-btn').addEventListener('click', generateCards);
}

/**
 * Handles what happens when a user selects a template from the dropdown.
 */
function handleTemplateChange(e) {
    const templateId = e.target.value;
    const template = templates.find(t => t.id === templateId);
    const previewEl = document.getElementById('template-preview');
    const detailsEl = document.getElementById('template-details');

    if (template) {
        detailsEl.innerHTML = `
            <p><strong>Company:</strong> ${template.company_name || 'Not specified'}</p>
            <p><strong>Orientation:</strong> ${template.orientation}</p>
        `;
        previewEl.style.display = 'block';
    } else {
        previewEl.style.display = 'none';
    }
    updateGenerateButton();
}

/**
 * Toggles all employee checkboxes between selected and deselected.
 */
function selectAllEmployees() {
    const checkboxes = document.querySelectorAll('.employee-checkbox');
    const isAnyUnchecked = Array.from(checkboxes).some(cb => !cb.checked);
    checkboxes.forEach(cb => cb.checked = isAnyUnchecked);
    updateSelectionSummary();
}

/**
 * Shows or hides the department filter dropdown.
 */
function toggleDepartmentFilter() {
    const filter = document.getElementById('department-filter');
    filter.style.display = filter.style.display === 'none' ? 'inline-block' : 'none';
}

/**
 * Selects all employees belonging to the chosen department.
 */
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

/**
 * Updates the "Selected: X people" text and checks if the generate button should be enabled.
 */
function updateSelectionSummary() {
    const checkedBoxes = document.querySelectorAll('.employee-checkbox:checked');
    selectedEmployeeIds = Array.from(checkedBoxes).map(cb => cb.dataset.employeeId);
    
    document.getElementById('selection-summary').textContent = `Selected: ${selectedEmployeeIds.length} people`;
    updateGenerateButton();
}

/**
 * Enables or disables the "Generate Cards" button based on user selections.
 */
function updateGenerateButton() {
    const btn = document.getElementById('generate-cards-btn');
    const hasTemplate = !!document.getElementById('template-select').value;
    const hasEmployees = selectedEmployeeIds.length > 0;
    
    btn.disabled = !hasTemplate || !hasEmployees;
    btn.textContent = hasEmployees 
        ? `🚀 Generate Cards (${selectedEmployeeIds.length})` 
        : '🚀 Generate Cards';
}


// --- 6. Core Logic ---

/**
 * Gathers all selected data and sends it to the Netlify function to generate the PDF.
 */
async function generateCards() {
    const templateId = document.getElementById('template-select').value;
    if (!templateId) {
        alert('Please select a template.');
        return;
    }
    if (selectedEmployeeIds.length === 0) {
        alert('Please select at least one employee.');
        return;
    }

    // Collect print settings
    const printSettings = {
        layout: document.querySelector('input[name="print-layout"]:checked').value,
        include_cropmarks: document.getElementById('include-cropmarks').checked,
        double_sided: document.getElementById('double-sided').checked
    };

    // UI updates for loading state
    const btn = document.getElementById('generate-cards-btn');
    const progressSection = document.getElementById('progress-section');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const downloadSection = document.getElementById('download-section');
    
    btn.disabled = true;
    progressSection.style.display = 'block';
    downloadSection.style.display = 'none';
    progressFill.style.width = '0%';
    progressText.textContent = 'Preparing data...';

    try {
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        if (sessionError || !session) throw new Error('Could not get user session. Please log in again.');

        progressFill.style.width = '20%';
        progressText.textContent = 'Generating PDF on the server... (this may take a moment)';
        
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
        progressText.textContent = 'Receiving file...';

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'An error occurred while generating the PDF.');
        }

        progressFill.style.width = '100%';
        progressText.textContent = 'File created successfully!';
        
        showDownloadLink(result);

    } catch (error) {
        console.error('Generate cards error:', error);
        progressText.textContent = `Error: ${error.message}`;
        progressFill.style.backgroundColor = '#dc2626'; // Red
        alert(`An error occurred: ${error.message}`);
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
 * Displays the download link section after the PDF is successfully generated.
 */
function showDownloadLink(result) {
    const section = document.getElementById('download-section');
    const linksEl = document.getElementById('download-links');
    
    linksEl.innerHTML = `
        <div style="text-align: center; padding: 20px; border: 2px dashed var(--secondary-color); border-radius: 8px;">
            <h3>✅ PDF Created!</h3>
            <p>Cards generated: <strong>${result.cards_generated || 0}</strong></p>
            <a href="${result.pdfData}" download="employee-cards.pdf" 
               style="display: inline-block; background: var(--secondary-color); color: white; padding: 15px 30px; 
                      text-decoration: none; border-radius: 8px; font-weight: bold; margin: 10px;">
                📥 Download PDF
            </a>
        </div>
    `;
    section.style.display = 'block';
}