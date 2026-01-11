// ReDD Map - Danish 6-Month Calendar App
// Main application logic

const { ipcRenderer } = require('electron');

// State
let currentYear = new Date().getFullYear();
let currentHalf = new Date().getMonth() < 6 ? 1 : 2;
let freeformNotes = []; // Array of {id, text, html, x, y, year, half}
let freeformLines = []; // Array of {id, x1, y1, x2, y2, year, half, color, width}

// Editor/Selection State
let selectedElement = null; // { type: 'note'|'line', id: string, element: HTMLElement }
let quillInstance = null;
let lastDeletedItem = null; // { type: 'note'|'line', data: object }
let undoTimeout = null;

// Danish month names
const MONTHS_DA = [
    'Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'December'
];

// Danish weekday abbreviations (Monday = 0)
const WEEKDAYS_DA = ['Ma', 'Ti', 'On', 'To', 'Fr', 'Lø', 'Sø'];

// Calculate Easter Sunday using the Anonymous Gregorian algorithm
function getEasterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
}

// Get Danish holidays for a given year
function getDanishHolidays(year) {
    const easter = getEasterSunday(year);
    const holidays = {};

    const addDays = (date, days) => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    };

    const formatKey = (date) => {
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${m}-${d}`;
    };

    // Easter-based holidays
    holidays[formatKey(addDays(easter, -7))] = 'Palmesøndag';
    holidays[formatKey(addDays(easter, -3))] = 'Skærtorsdag';
    holidays[formatKey(addDays(easter, -2))] = 'Langfredag';
    holidays[formatKey(easter)] = 'Påskedag';
    holidays[formatKey(addDays(easter, 1))] = '2. påskedag';
    holidays[formatKey(addDays(easter, 39))] = 'Kr. himmelfartsdag';
    holidays[formatKey(addDays(easter, 49))] = 'Pinsedag';
    holidays[formatKey(addDays(easter, 50))] = '2. pinsedag';

    // Fixed holidays
    holidays[`${year}-01-01`] = 'Nytårsdag';
    holidays[`${year}-06-05`] = 'Grundlovsdag';
    holidays[`${year}-12-24`] = 'Juleaften';
    holidays[`${year}-12-25`] = 'Juledag';
    holidays[`${year}-12-26`] = '2. Juledag';

    return holidays;
}

// Cache holidays
let cachedHolidaysYear = null;
let cachedHolidays = {};

function getHolidays(year) {
    if (cachedHolidaysYear !== year) {
        cachedHolidaysYear = year;
        cachedHolidays = getDanishHolidays(year);
    }
    return cachedHolidays;
}

// Storage keys
const NOTES_KEY = 'redd-map-freeform-notes';
const LINES_KEY = 'redd-map-freeform-lines';
const THEME_KEY = 'redd-map-theme';

// DOM Elements
let calendarContainer;
let canvasLayer;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    calendarContainer = document.getElementById('calendar-container');
    canvasLayer = document.getElementById('canvas-layer');

    loadData();
    loadTheme();
    setupWindowControls();
    setupEventListeners();
    setupCanvasInteraction();
    updatePeriodDisplay();
    renderCalendar();
    renderFreeformElements();
});

// Load data from localStorage
function loadData() {
    try {
        const storedNotes = localStorage.getItem(NOTES_KEY);
        if (storedNotes) {
            freeformNotes = JSON.parse(storedNotes);
        }
        const storedLines = localStorage.getItem(LINES_KEY);
        if (storedLines) {
            freeformLines = JSON.parse(storedLines);
        }
    } catch (e) {
        console.error('Failed to load data:', e);
        freeformNotes = [];
        freeformLines = [];
    }
}

// Save data to localStorage
function saveData() {
    try {
        localStorage.setItem(NOTES_KEY, JSON.stringify(freeformNotes));
        localStorage.setItem(LINES_KEY, JSON.stringify(freeformLines));
    } catch (e) {
        console.error('Failed to save data:', e);
    }
}

// Load theme preference
function loadTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
}

// Toggle theme
function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
}

// Setup window controls (Windows/Linux)
function setupWindowControls() {
    const windowControls = document.getElementById('window-controls');
    if (navigator.platform.toLowerCase().includes('win') ||
        navigator.platform.toLowerCase().includes('linux')) {
        windowControls.classList.remove('hidden');
    }

    document.getElementById('min-btn')?.addEventListener('click', () => {
        ipcRenderer.send('window-minimize');
    });

    document.getElementById('max-btn')?.addEventListener('click', () => {
        ipcRenderer.send('window-maximize');
    });

    document.getElementById('close-btn')?.addEventListener('click', () => {
        ipcRenderer.send('window-close');
    });
}

// Setup event listeners
function setupEventListeners() {
    const periodDisplay = document.getElementById('period-display');
    const prevPeriodBtn = document.getElementById('prev-period-btn');
    const nextPeriodBtn = document.getElementById('next-period-btn');
    const themeToggleBtn = document.getElementById('theme-toggle-btn');

    prevPeriodBtn.addEventListener('click', () => {
        if (currentHalf === 1) {
            currentYear--;
            currentHalf = 2;
        } else {
            currentHalf = 1;
        }
        updatePeriodDisplay();
        renderCalendar();
        renderFreeformElements();
    });

    nextPeriodBtn.addEventListener('click', () => {
        if (currentHalf === 2) {
            currentYear++;
            currentHalf = 1;
        } else {
            currentHalf = 2;
        }
        updatePeriodDisplay();
        renderCalendar();
        renderFreeformElements();
    });

    themeToggleBtn.addEventListener('click', toggleTheme);

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('note-input-inline')) return;

        if (e.key === 'ArrowLeft') {
            prevPeriodBtn.click();
        } else if (e.key === 'ArrowRight') {
            nextPeriodBtn.click();
        }
    });
}

// Update period display
function updatePeriodDisplay() {
    const periodDisplay = document.getElementById('period-display');
    const periodText = currentHalf === 1 ? `Jan – Jun ${currentYear}` : `Jul – Dec ${currentYear}`;
    periodDisplay.textContent = periodText;
}

// Get week number (week 1 contains January 1)
function getWeekNumber(date) {
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const startDay = startOfYear.getDay();
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
    const firstMonday = new Date(startOfYear);
    firstMonday.setDate(startOfYear.getDate() + mondayOffset);

    const daysSinceFirstMonday = Math.floor((date - firstMonday) / 86400000);
    let weekNum = Math.floor(daysSinceFirstMonday / 7) + 1;
    if (weekNum < 1) weekNum = 1;

    return weekNum;
}

// Get weekday index (Monday = 0, Sunday = 6)
function getWeekdayIndex(date) {
    const day = date.getDay();
    return day === 0 ? 6 : day - 1;
}

// Get days in month
function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

// Format date key
function formatDateKey(year, month, day) {
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
}

// Check if date is today
function isToday(year, month, day) {
    const today = new Date();
    return year === today.getFullYear() &&
        month === today.getMonth() &&
        day === today.getDate();
}

// Render the calendar grid
function renderCalendar() {
    const calendarGrid = document.getElementById('calendar-grid');
    calendarGrid.innerHTML = '';

    const startMonth = currentHalf === 1 ? 0 : 6;
    const endMonth = currentHalf === 1 ? 5 : 11;

    for (let month = startMonth; month <= endMonth; month++) {
        const monthColumn = createMonthColumn(month);
        calendarGrid.appendChild(monthColumn);
    }
}

// Create a month column
function createMonthColumn(month) {
    const column = document.createElement('div');
    column.className = 'month-column';

    const header = document.createElement('div');
    header.className = 'month-header';
    header.textContent = MONTHS_DA[month];
    column.appendChild(header);

    const daysContainer = document.createElement('div');
    daysContainer.className = 'days-container';

    const daysInMonth = getDaysInMonth(currentYear, month);

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(currentYear, month, day);
        const weekdayIndex = getWeekdayIndex(date);
        const isWeekend = weekdayIndex >= 5;
        const dateKey = formatDateKey(currentYear, month, day);
        const todayClass = isToday(currentYear, month, day) ? ' today' : '';
        const weekendClass = isWeekend ? ' weekend' : '';

        const dayRow = document.createElement('div');
        dayRow.className = `day-row${todayClass}${weekendClass}`;
        dayRow.dataset.dateKey = dateKey;

        const dayName = document.createElement('span');
        dayName.className = 'day-name';
        dayName.textContent = WEEKDAYS_DA[weekdayIndex];
        dayRow.appendChild(dayName);

        const dayNumber = document.createElement('span');
        dayNumber.className = 'day-number';
        dayNumber.textContent = day;
        dayRow.appendChild(dayNumber);

        // Holiday display area
        const holidays = getHolidays(currentYear);
        const holiday = holidays[dateKey];

        const noteArea = document.createElement('div');
        noteArea.className = 'note-area';

        if (holiday) {
            const holidayEl = document.createElement('span');
            holidayEl.className = 'note-text holiday';
            holidayEl.textContent = holiday;
            holidayEl.style.left = '0px';
            noteArea.appendChild(holidayEl);
        }

        dayRow.appendChild(noteArea);

        // Week number on Sunday
        if (weekdayIndex === 6) {
            const weekNum = document.createElement('span');
            weekNum.className = 'week-number';
            weekNum.textContent = getWeekNumber(date);
            dayRow.appendChild(weekNum);
        }

        daysContainer.appendChild(dayRow);
    }

    column.appendChild(daysContainer);
    return column;
}

// Setup canvas interaction for freeform notes and lines
function setupCanvasInteraction() {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let tempLine = null;

    calendarContainer.addEventListener('mousedown', (e) => {
        // Don't interact if clicking on certain elements
        if (e.target.classList.contains('note-text') ||
            e.target.classList.contains('note-input-inline') ||
            e.target.classList.contains('note-line') ||
            e.target.classList.contains('month-header') ||
            e.target.closest('.title-bar') ||
            e.target.closest('.footer')) {
            return;
        }

        // Use canvas layer rect for accurate positioning
        const canvasRect = canvasLayer.getBoundingClientRect();
        startX = e.clientX - canvasRect.left;
        startY = e.clientY - canvasRect.top + calendarContainer.scrollTop;
        isDragging = false;

        // Create temporary line
        tempLine = document.createElement('div');
        tempLine.className = 'note-line temp';
        tempLine.style.left = startX + 'px';
        tempLine.style.top = startY + 'px';
        tempLine.style.width = '0px';
        canvasLayer.appendChild(tempLine);

        const onMouseMove = (moveEvent) => {
            const currentX = moveEvent.clientX - canvasRect.left;
            const currentY = moveEvent.clientY - canvasRect.top + calendarContainer.scrollTop;
            const dx = currentX - startX;
            const dy = currentY - startY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 5) {
                isDragging = true;
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                tempLine.style.width = distance + 'px';
                tempLine.style.transform = `rotate(${angle}deg)`;
                tempLine.style.transformOrigin = '0 50%';
            }
        };

        const onMouseUp = (upEvent) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            if (tempLine) {
                tempLine.remove();
                tempLine = null;
            }

            const endX = upEvent.clientX - canvasRect.left;
            const endY = upEvent.clientY - canvasRect.top + calendarContainer.scrollTop;
            const dx = endX - startX;
            const dy = endY - startY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (isDragging && distance > 10) {
                // Create line with start/end points
                const lineId = Date.now().toString();
                const defaultColor = '#667eea';
                const defaultWidth = 8;
                freeformLines.push({
                    id: lineId,
                    x1: startX,
                    y1: startY,
                    x2: endX,
                    y2: endY,
                    color: defaultColor,
                    width: defaultWidth,
                    year: currentYear,
                    half: currentHalf
                });
                saveData();

                const lineEl = createFreeformLine(lineId, startX, startY, endX, endY, defaultColor, defaultWidth);
                canvasLayer.appendChild(lineEl);
            } else {
                // Check if there's an existing input - if so, just close it (blur triggers save)
                const existingInput = canvasLayer.querySelector('.note-input-inline');
                if (existingInput) {
                    existingInput.blur();
                } else {
                    // Create text input
                    createFreeformInput(startX, startY);
                }
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// Render freeform elements for current period
function renderFreeformElements() {
    canvasLayer.innerHTML = '';

    freeformNotes
        .filter(note => note.year === currentYear && note.half === currentHalf)
        .forEach(note => {
            const noteEl = createFreeformNote(note.id, note.text, note.x, note.y);
            canvasLayer.appendChild(noteEl);
        });

    freeformLines
        .filter(line => line.year === currentYear && line.half === currentHalf)
        .forEach(line => {
            // Support both old (x1, x2, y) and new (x1, y1, x2, y2) format
            const y1 = line.y1 !== undefined ? line.y1 : line.y;
            const y2 = line.y2 !== undefined ? line.y2 : line.y;
            const lineEl = createFreeformLine(line.id, line.x1, y1, line.x2, y2, line.color, line.width);
            canvasLayer.appendChild(lineEl);
        });
}

// Create freeform note element
function createFreeformNote(id, text, x, y) {
    const noteEl = document.createElement('span');
    noteEl.className = 'note-text freeform';
    noteEl.textContent = text;
    noteEl.style.left = x + 'px';
    noteEl.style.top = y + 'px';
    noteEl.dataset.noteId = id;

    // Track if we're dragging (to distinguish from click)
    let hasDragged = false;

    // Mousedown starts potential drag
    noteEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        hasDragged = false;
        const mouseStartX = e.clientX;
        const mouseStartY = e.clientY;
        const startLeft = parseInt(noteEl.style.left) || 0;
        const startTop = parseInt(noteEl.style.top) || 0;

        noteEl.classList.add('dragging');

        const onMouseMove = (moveEvent) => {
            const deltaX = moveEvent.clientX - mouseStartX;
            const deltaY = moveEvent.clientY - mouseStartY;

            // Only consider it a drag if moved more than 5 pixels
            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                hasDragged = true;
            }

            noteEl.style.left = Math.max(0, startLeft + deltaX) + 'px';
            noteEl.style.top = Math.max(0, startTop + deltaY) + 'px';
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            noteEl.classList.remove('dragging');

            const note = freeformNotes.find(n => n.id === id);
            if (note) {
                note.x = parseInt(noteEl.style.left) || 0;
                note.y = parseInt(noteEl.style.top) || 0;
                saveData();
            }

            // If it was a click (not drag), show editor
            if (!hasDragged) {
                showNoteEditor(id, noteEl);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    return noteEl;
}

// Create freeform input
function createFreeformInput(x, y, existingText = '', existingId = null) {
    const existingInput = canvasLayer.querySelector('.note-input-inline');
    if (existingInput) existingInput.remove();

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-input-inline';
    input.style.left = x + 'px';
    input.style.top = y + 'px';
    input.value = existingText;
    input.placeholder = 'Type here...';

    const finishEditing = () => {
        const text = input.value.trim();
        input.remove();

        if (text) {
            let noteId = existingId;
            if (existingId) {
                const note = freeformNotes.find(n => n.id === existingId);
                if (note) note.text = text;
            } else {
                noteId = Date.now().toString();
                freeformNotes.push({
                    id: noteId,
                    text, x, y,
                    year: currentYear,
                    half: currentHalf
                });
            }
            saveData();

            const noteEl = createFreeformNote(noteId, text, x, y);
            canvasLayer.appendChild(noteEl);
        } else if (existingId) {
            freeformNotes = freeformNotes.filter(n => n.id !== existingId);
            saveData();
        }
    };

    input.addEventListener('blur', finishEditing);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            input.value = existingText;
            input.blur();
        }
    });

    canvasLayer.appendChild(input);
    input.focus();
}

// Create freeform line (supports diagonal)
function createFreeformLine(id, x1, y1, x2, y2, color, width) {
    // Container for line and handles
    const container = document.createElement('div');
    container.className = 'note-line-container';
    container.dataset.lineId = id;

    // Use defaults if not specified
    color = color || '#667eea';
    width = width || 8;

    // Update line geometry
    function updateLineGeometry() {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        lineEl.style.left = x1 + 'px';
        lineEl.style.top = y1 + 'px';
        lineEl.style.width = length + 'px';
        lineEl.style.transform = `rotate(${angle}deg)`;

        // Update handle positions
        startHandle.style.left = (x1 - 5) + 'px';
        startHandle.style.top = (y1 - 5) + 'px';
        endHandle.style.left = (x2 - 5) + 'px';
        endHandle.style.top = (y2 - 5) + 'px';
    }

    // The line element
    const lineEl = document.createElement('div');
    lineEl.className = 'note-line';
    lineEl.style.transformOrigin = '0 50%';
    lineEl.style.background = color;
    lineEl.style.height = width + 'px';
    lineEl.title = 'Click to edit, drag to move';

    // Start handle (at x1, y1)
    const startHandle = document.createElement('div');
    startHandle.className = 'line-handle start';
    startHandle.title = 'Drag to resize';

    // End handle (at x2, y2)
    const endHandle = document.createElement('div');
    endHandle.className = 'line-handle end';
    endHandle.title = 'Drag to resize';

    container.appendChild(lineEl);
    container.appendChild(startHandle);
    container.appendChild(endHandle);

    updateLineGeometry();

    // Track dragging to distinguish from click
    let hasDragged = false;

    // Drag line to move (mousedown)
    lineEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        hasDragged = false;
        const mouseStartX = e.clientX;
        const mouseStartY = e.clientY;
        const origX1 = x1, origY1 = y1, origX2 = x2, origY2 = y2;

        lineEl.classList.add('dragging');

        const onMouseMove = (moveEvent) => {
            const deltaX = moveEvent.clientX - mouseStartX;
            const deltaY = moveEvent.clientY - mouseStartY;

            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                hasDragged = true;
            }

            x1 = origX1 + deltaX;
            y1 = origY1 + deltaY;
            x2 = origX2 + deltaX;
            y2 = origY2 + deltaY;
            updateLineGeometry();
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            lineEl.classList.remove('dragging');

            // Save position
            const line = freeformLines.find(l => l.id === id);
            if (line) {
                line.x1 = x1; line.y1 = y1;
                line.x2 = x2; line.y2 = y2;
                saveData();
            }

            // If it was a click (not drag), show line editor
            if (!hasDragged) {
                showLineEditor(id, lineEl);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Resize from start handle
    startHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const canvasRect = canvasLayer.getBoundingClientRect();

        const onMouseMove = (moveEvent) => {
            x1 = moveEvent.clientX - canvasRect.left;
            y1 = moveEvent.clientY - canvasRect.top + calendarContainer.scrollTop;
            updateLineGeometry();
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const line = freeformLines.find(l => l.id === id);
            if (line) {
                line.x1 = x1; line.y1 = y1;
                saveData();
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Resize from end handle
    endHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const canvasRect = canvasLayer.getBoundingClientRect();

        const onMouseMove = (moveEvent) => {
            x2 = moveEvent.clientX - canvasRect.left;
            y2 = moveEvent.clientY - canvasRect.top + calendarContainer.scrollTop;
            updateLineGeometry();
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const line = freeformLines.find(l => l.id === id);
            if (line) {
                line.x2 = x2; line.y2 = y2;
                saveData();
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    return container;
}

// ==========================================
// UNDO TOAST SYSTEM
// ==========================================

function showUndoToast(message) {
    const undoToast = document.getElementById('undo-toast');
    const undoMessage = document.getElementById('undo-message');

    undoMessage.textContent = message;
    undoToast.classList.remove('hidden');

    if (undoTimeout) clearTimeout(undoTimeout);

    undoTimeout = setTimeout(() => {
        hideUndoToast();
    }, 5000);
}

function hideUndoToast() {
    const undoToast = document.getElementById('undo-toast');
    undoToast.classList.add('hidden');
    if (undoTimeout) clearTimeout(undoTimeout);
}

function performUndo() {
    if (!lastDeletedItem) return;

    if (lastDeletedItem.type === 'note') {
        freeformNotes.push(lastDeletedItem.data);
        saveData();
        renderFreeformElements();
    } else if (lastDeletedItem.type === 'line') {
        freeformLines.push(lastDeletedItem.data);
        saveData();
        renderFreeformElements();
    }

    lastDeletedItem = null;
    hideUndoToast();
}

// Setup undo toast event listeners
function setupUndoListeners() {
    document.getElementById('undo-btn').addEventListener('click', performUndo);
    document.getElementById('close-undo-btn').addEventListener('click', hideUndoToast);
}

// ==========================================
// ELEMENT POPUPS
// ==========================================

function showNoteEditor(noteId, noteElement) {
    const note = freeformNotes.find(n => n.id === noteId);
    if (!note) return;

    // Mark as selected
    deselectElement();
    selectedElement = { type: 'note', id: noteId, element: noteElement };
    noteElement.classList.add('selected');

    const popup = document.getElementById('note-editor-popup');
    const container = document.getElementById('note-editor-container');

    // Position popup near element
    const rect = noteElement.getBoundingClientRect();
    popup.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
    popup.style.top = Math.min(rect.bottom + 8, window.innerHeight - 250) + 'px';

    popup.classList.remove('hidden');

    // Initialize Quill if not done
    if (!quillInstance) {
        container.innerHTML = '';
        quillInstance = new Quill(container, {
            theme: 'snow',
            placeholder: 'Type your note...',
            modules: {
                toolbar: [
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['clean']
                ]
            }
        });

        quillInstance.on('text-change', () => {
            if (selectedElement && selectedElement.type === 'note') {
                const currentNote = freeformNotes.find(n => n.id === selectedElement.id);
                if (currentNote) {
                    currentNote.html = quillInstance.root.innerHTML;
                    currentNote.text = quillInstance.getText().trim();
                    saveData();
                    // Update element text
                    selectedElement.element.textContent = currentNote.text || 'Empty note';
                }
            }
        });
    }

    // Load content
    if (note.html) {
        quillInstance.root.innerHTML = note.html;
    } else {
        quillInstance.setText(note.text || '');
    }

    quillInstance.focus();
}

function showLineEditor(lineId, lineElement) {
    const line = freeformLines.find(l => l.id === lineId);
    if (!line) return;

    // Mark as selected
    deselectElement();
    selectedElement = { type: 'line', id: lineId, element: lineElement };
    lineElement.classList.add('selected');

    const popup = document.getElementById('line-editor-popup');

    // Position popup near element
    const rect = lineElement.getBoundingClientRect();
    popup.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
    popup.style.top = Math.min(rect.bottom + 8, window.innerHeight - 200) + 'px';

    popup.classList.remove('hidden');

    // Update selection state in popup
    const currentColor = line.color || '#667eea';
    const currentWidth = line.width || 8;

    popup.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.classList.toggle('selected', swatch.dataset.color === currentColor);
    });

    popup.querySelectorAll('.width-btn').forEach(btn => {
        btn.classList.toggle('selected', parseInt(btn.dataset.width) === currentWidth);
    });
}

function deselectElement() {
    if (selectedElement) {
        selectedElement.element.classList.remove('selected');
        selectedElement = null;
    }
    document.getElementById('note-editor-popup').classList.add('hidden');
    document.getElementById('line-editor-popup').classList.add('hidden');
}

function deleteSelectedElement() {
    if (!selectedElement) return;

    if (selectedElement.type === 'note') {
        const note = freeformNotes.find(n => n.id === selectedElement.id);
        if (note) {
            lastDeletedItem = { type: 'note', data: JSON.parse(JSON.stringify(note)) };
            freeformNotes = freeformNotes.filter(n => n.id !== selectedElement.id);
            saveData();
            selectedElement.element.remove();
            showUndoToast('Note deleted');
        }
    } else if (selectedElement.type === 'line') {
        const line = freeformLines.find(l => l.id === selectedElement.id);
        if (line) {
            lastDeletedItem = { type: 'line', data: JSON.parse(JSON.stringify(line)) };
            freeformLines = freeformLines.filter(l => l.id !== selectedElement.id);
            saveData();
            // For lines, element is the container
            selectedElement.element.closest('.note-line-container')?.remove() || selectedElement.element.remove();
            showUndoToast('Line deleted');
        }
    }

    deselectElement();
}

function setupPopupListeners() {
    // Note delete button
    document.getElementById('note-delete-btn').addEventListener('click', deleteSelectedElement);

    // Line delete button
    document.getElementById('line-delete-btn').addEventListener('click', deleteSelectedElement);

    // Line color swatches
    document.getElementById('line-editor-popup').querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            if (selectedElement && selectedElement.type === 'line') {
                const line = freeformLines.find(l => l.id === selectedElement.id);
                if (line) {
                    line.color = swatch.dataset.color;
                    saveData();

                    // Update visual
                    const lineEl = selectedElement.element.closest('.note-line-container')?.querySelector('.note-line') || selectedElement.element;
                    lineEl.style.background = line.color;

                    // Update selection state
                    document.getElementById('line-editor-popup').querySelectorAll('.color-swatch').forEach(s => {
                        s.classList.toggle('selected', s.dataset.color === line.color);
                    });
                }
            }
        });
    });

    // Line width buttons
    document.getElementById('line-editor-popup').querySelectorAll('.width-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (selectedElement && selectedElement.type === 'line') {
                const line = freeformLines.find(l => l.id === selectedElement.id);
                if (line) {
                    line.width = parseInt(btn.dataset.width);
                    saveData();

                    // Update visual
                    const lineEl = selectedElement.element.closest('.note-line-container')?.querySelector('.note-line') || selectedElement.element;
                    lineEl.style.height = line.width + 'px';

                    // Update selection state
                    document.getElementById('line-editor-popup').querySelectorAll('.width-btn').forEach(b => {
                        b.classList.toggle('selected', parseInt(b.dataset.width) === line.width);
                    });
                }
            }
        });
    });

    // Click outside to deselect
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.element-popup') &&
            !e.target.closest('.note-text.freeform') &&
            !e.target.closest('.note-line-container') &&
            !e.target.closest('.note-line')) {
            deselectElement();
        }
    });

    // Escape to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            deselectElement();
        }
    });
}

// Initialize popup listeners after DOM ready
document.addEventListener('DOMContentLoaded', () => {
    setupUndoListeners();
    setupPopupListeners();
});
