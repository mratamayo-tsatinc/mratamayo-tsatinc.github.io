const EXERCISES = [
    // EASY - Simple if statements
    '1A.c',
    '1B.c',
    '1C.c',
    '1D.c',
    '1E.c',
    '1F.c',
    '1G.c',
    '1H.c',
    '1I.c',
    '1J.c',

    '2A.c',
    '2B.c',
    '2C.c',
    '2D.c',
    '2E.c',
    '2F.c',
    '2G.c',
    '2H.c',
    '2I.c',
    '2J.c',

    '3A.c',
    '3B.c',
    '3C.c',
    '3D.c',
    '3E.c',
    '3F.c',
    '3G.c',
    '3H.c',
    '3I.c',
    '3J.c'
];

let studentDatabase = [];
let exerciseData = {}; 
let currentFile = "";
let currentUser = "";
let appMode = 'exam'; // 'practice' | 'exam'
let examMinutes = 30; // default minutes for exam mode
let timerSeconds = 0;
let timerInterval = null;
let scoreModalShown = true;
// Track whether we've already shown the full-course celebration
let totalCelebrated = true;
// ISO timestamp marking when the current exam session began (used to persist/resume the timer)
let examStartTime = null;

const EXAM_STORAGE_PREFIX = 'bugcatcher_exam_';

window.onload = async function() {
    try {
        const res = await fetch('students.csv');
        const text = await res.text();
        const rows = text.split('\n').slice(1);
        studentDatabase = rows.map(row => {
            const [email, id] = row.split(',');
            return { email: email?.trim(), id: id?.trim() };
        });
    } catch (err) { console.error("Database failed to load."); }
};

    // EXAM PERSISTENCE (only used while appMode === 'exam')
    function getExamStorageKey(email) {
        return `${EXAM_STORAGE_PREFIX}${email}`;
    }

    // Saves the current exam session (answers, scores, lock state, timer start) to localStorage
    // so a page refresh / accidental close doesn't lose progress or reset the clock.
    function saveExamState() {
        if (appMode !== 'exam' || !currentUser) return;
        try {
            const serializedExercises = {};
            for (const file in exerciseData) {
                const d = exerciseData[file];
                serializedExercises[file] = {
                    userProgress: d.userProgress,
                    lastScore: d.lastScore,
                    locked: d.locked,
                    lastVerifiedAt: d.lastVerifiedAt
                };
            }
            const state = {
                email: currentUser,
                examMinutes,
                examStartTime,
                exerciseData: serializedExercises,
                scoreModalShown,
                totalCelebrated,
                savedAt: new Date().toISOString()
            };
            localStorage.setItem(getExamStorageKey(currentUser), JSON.stringify(state));
        } catch (err) {
            console.error("Failed to save exam progress.", err);
        }
    }

    function loadExamState(email) {
        try {
            const raw = localStorage.getItem(getExamStorageKey(email));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (err) {
            console.error("Failed to load saved exam progress.", err);
            return null;
        }
    }

    function clearExamState(email) {
        try { localStorage.removeItem(getExamStorageKey(email)); } catch (err) { /* ignore */ }
    }

    // SETTINGS & MODAL HANDLERS
    function openSettingsModal() {
        const m = document.getElementById('settingsModal');
        if (!m) return;
        // reflect current mode
        const radios = document.getElementsByName('appMode');
        radios.forEach(r => r.checked = (r.value === appMode));
        const examSettings = document.getElementById('examSettings');
        examSettings.style.display = (appMode === 'exam') ? 'block' : 'none';
        document.getElementById('examMinutesInput').value = examMinutes;
        m.style.display = 'flex';
    }

    function closeSettingsModal() {
        const m = document.getElementById('settingsModal'); if (m) m.style.display = 'none';
    }

    function saveSettings() {
        const radios = document.getElementsByName('appMode');
        let selected = 'practice';
        radios.forEach(r => { if (r.checked) selected = r.value; });
        const minutesInput = document.getElementById('examMinutesInput');
        const mins = parseInt(minutesInput.value, 10);
        if (selected === 'exam') {
            if (!Number.isInteger(mins) || mins < 1 || mins > 180) {
                minutesInput.classList.add('invalid');
                minutesInput.focus();
                return;
            }
            examMinutes = mins;
        }
        appMode = selected;
        // if user already logged in, apply timer visibility/behavior immediately
        if (currentUser) {
            if (appMode === 'exam') {
                examStartTime = new Date().toISOString();
                startTimer(examMinutes);
                saveExamState();
            } else {
                stopTimer();
                const display = document.getElementById('timerDisplay'); if (display) display.style.display = 'none';
                // Leaving exam mode ends the persisted session for this student
                clearExamState(currentUser);
            }
        }
        closeSettingsModal();
    }

    // react to mode radio changes inside modal (delegated from HTML on change)
    document.addEventListener('change', (e) => {
        if (!e.target) return;
        if (e.target.name === 'appMode') {
            const examSettings = document.getElementById('examSettings');
            examSettings.style.display = (e.target.value === 'exam') ? 'block' : 'none';
        }
    });

    // TIMER
    function startTimer(minutes) {
        startTimerSeconds(Math.max(0, Math.floor(minutes) * 60));
    }

    // Starts the countdown from an explicit number of seconds (used when resuming a
    // persisted exam session after a reload, where less than the full duration remains).
    function startTimerSeconds(seconds) {
        stopTimer();
        timerSeconds = Math.max(0, Math.floor(seconds));
        updateTimerUI();
        const display = document.getElementById('timerDisplay'); if (display) display.style.display = 'inline-flex';
        timerInterval = setInterval(() => {
            timerSeconds--;
            updateTimerUI();
            if (timerSeconds <= 0) {
                stopTimer();
                onTimerExpire();
            }
        }, 1000);
    }

    // Resumes the exam timer based on real elapsed time since examStartTime, so that
    // reloading or reopening the page cannot be used to "reset the clock".
    function resumeExamTimer() {
        if (!examStartTime) {
            examStartTime = new Date().toISOString();
        }
        const startMs = new Date(examStartTime).getTime();
        const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
        const totalSec = Math.max(0, Math.floor(examMinutes) * 60);
        const remaining = totalSec - elapsedSec;

        if (remaining <= 0) {
            // Time ran out while the student was away/reloading
            timerSeconds = 0;
            updateTimerUI();
            const display = document.getElementById('timerDisplay'); if (display) display.style.display = 'inline-flex';
            onTimerExpire();
            return;
        }
        startTimerSeconds(remaining);
    }

    function stopTimer() {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    }

    function updateTimerUI() {
        const display = document.getElementById('timerDisplay');
        if (!display) return;
        const mm = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
        const ss = String(timerSeconds % 60).padStart(2, '0');
        display.textContent = `${mm}:${ss}`;
        // UX: when under 60 seconds, show warning color for urgency
        if (timerSeconds <= 60 && timerSeconds > 0) {
            display.classList.add('warning');
        } else {
            display.classList.remove('warning');
        }
    }

    function onTimerExpire() {
        const fb = document.getElementById('feedback');
        if (fb) { fb.textContent = 'Time is up — exam finished.'; fb.style.color = 'var(--error)'; }
        // Ensure no further resets are possible; keep inputs disabled
        for (const file in exerciseData) {
            const data = exerciseData[file];
            // lock everything not already verified
            if (!data.locked) data.locked = true;
        }
        updateTotalScore();
        showScoreModal('time');
        saveExamState();
    }

function handleLogin() {
    const email = document.getElementById('emailInput').value.trim();
    const id = document.getElementById('studentNumInput').value.trim();
    const user = studentDatabase.find(s => s.email === email && s.id === id);
    
    if (user) {
        currentUser = email;
        scoreModalShown = false;
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('appContainer').style.display = 'flex';
        document.getElementById('userDisplay').textContent = email;

        if (appMode === 'exam') {
            // Look for a previously saved session for this student (e.g. after a refresh
            // or accidental tab close) and resume it instead of starting over.
            const saved = loadExamState(email);
            if (saved && saved.examStartTime) {
                examMinutes = saved.examMinutes || examMinutes;
                examStartTime = saved.examStartTime;
                scoreModalShown = !!saved.scoreModalShown;
                totalCelebrated = !!saved.totalCelebrated;
            } else {
                examStartTime = new Date().toISOString();
            }
        }

        loadAllExercises();

        // start/resume exam timer if in exam mode
        if (appMode === 'exam') {
            resumeExamTimer();
            saveExamState();
        } else {
            const display = document.getElementById('timerDisplay'); if (display) display.style.display = 'none';
        }
    } else {
        document.getElementById('loginError').textContent = "Invalid credentials.";
    }
}

async function loadAllExercises() {
    const list = document.getElementById('fileList');
    list.innerHTML = ""; 
    document.getElementById('loader').style.display = 'block';

    // Pull any previously saved exam progress for this student so it can be restored
    // into the freshly-parsed exercise data below.
    const savedExam = (appMode === 'exam' && currentUser) ? loadExamState(currentUser) : null;

    for (const fileName of EXERCISES) {
        try {
            const res = await fetch('./exercises/' + fileName);
            const code = await res.text();
            exerciseData[fileName] = parseJavaCode(code);

            if (savedExam && savedExam.exerciseData && savedExam.exerciseData[fileName]) {
                const saved = savedExam.exerciseData[fileName];
                const d = exerciseData[fileName];
                if (Array.isArray(saved.userProgress) && saved.userProgress.length === d.userProgress.length) {
                    d.userProgress = saved.userProgress;
                }
                d.lastScore = saved.lastScore || 0;
                d.locked = !!saved.locked;
                d.lastVerifiedAt = saved.lastVerifiedAt || null;
            }

            const li = document.createElement('li');
            const safeId = fileName.replace(/\./g, '-');
            li.id = `nav-${safeId}`;
            const restoredScore = exerciseData[fileName].lastScore || 0;

            li.innerHTML = `
                <span>${fileName.replace('.java', '')}</span>
                <span class="nav-score" id="score-${safeId}">${restoredScore}/${exerciseData[fileName].wrongCount}</span>
            `;
            if (exerciseData[fileName].locked && exerciseData[fileName].wrongCount > 0 && restoredScore === exerciseData[fileName].wrongCount) {
                li.querySelector('.nav-score').classList.add('completed-score');
            }
            
            li.onclick = () => switchExercise(fileName, li);
            list.appendChild(li);
        } catch (e) { console.warn("Missing: " + fileName); }
    }
    document.getElementById('loader').style.display = 'none';
    if (list.firstChild) list.firstChild.click();
    // Set total max score and accumulated score
    updateTotalScore();
    // Ensure timer visibility on the activity page according to mode
    const display = document.getElementById('timerDisplay');
    if (display) {
        if (appMode === 'exam') display.style.display = 'inline-flex';
        else display.style.display = 'none';
    }
}

function handleVerifyReset() {
    if (!currentFile) return;
    const data = exerciseData[currentFile];
    if (!data) return;
    if (data.locked) {
        resetCurrentExercise();
    } else {
        checkAnswers();
    }
}

function resetCurrentExercise() {
    if (!currentFile) return;
    const data = exerciseData[currentFile];
    if (!data) return;
    // In exam mode, resetting is disabled once an activity has been verified
    if (appMode === 'exam' && data.lastVerifiedAt) {
        const fb = document.getElementById('feedback');
        fb.textContent = 'Reset is disabled in Exam Mode.';
        fb.style.color = 'var(--error)';
        setTimeout(() => { fb.textContent = ''; }, 2500);
        return;
    }
    // clear selections
    data.userProgress = data.userProgress.map(() => false);
    data.lastScore = 0;
    data.locked = false;
    data.lastVerifiedAt = null;

    const inputs = document.querySelectorAll('.token-option input[type="checkbox"]');
    inputs.forEach((input, idx) => {
        input.checked = false;
        input.disabled = false;
        const label = input.parentElement;
        label.classList.remove('selected','wrong','correct','disabled');
    });

    // reset sidebar score for this file
    const safeId = currentFile.replace(/\./g, '-');
    const scoreSpan = document.getElementById(`score-${safeId}`);
    if (scoreSpan) scoreSpan.textContent = `0/${data.wrongCount}`;
    scoreSpan.classList.remove('completed-score');

    // reset UI
    const verifyBtn = document.getElementById('verifyBtn');
    if (verifyBtn) verifyBtn.textContent = 'Verify Code';
    document.getElementById('feedback').textContent = '';
    const selectedEl = document.getElementById('selectedCount');
    if (selectedEl) selectedEl.textContent = '0';

    // restore enable/disable according to selection rules
    switchExercise(currentFile, document.getElementById(`nav-${currentFile.replace(/\./g,'-')}`));

    // update total accumulated score
    updateTotalScore();
    saveExamState();
}

function updateTotalScore() {
    let totalCorrect = 0;
    let totalMax = 0;
    let allAnswered = true;
    for (const file in exerciseData) {
        const d = exerciseData[file];
        totalCorrect += d.lastScore || 0;
        totalMax += d.wrongCount || 0;
        if (!d.locked) allAnswered = false;
    }
    const acc = document.getElementById('accScore');
    const max = document.getElementById('maxScore');
    const totalBox = document.getElementById('totalScore');
    if (acc) acc.textContent = totalCorrect;
    if (max) max.textContent = totalMax;
    if (totalBox) {
        if (totalCorrect === totalMax && totalMax > 0) {
            totalBox.classList.add('completed');
            // trigger a single 'all exercises complete' celebration once (only for perfect score)
            if (!totalCelebrated) {
                totalCelebrated = true;
                triggerConfetti({ type: 'all' });
            }
        } else {
            totalBox.classList.remove('completed');
            totalCelebrated = false;
        }
        // Show final score summary when all exercises are answered (regardless of score)
        if (allAnswered && totalMax > 0 && !scoreModalShown) {
            showScoreModal('complete');
        }
    }
}

function tokenizeCode(code) {
    /**
     * Tokenize code into meaningful tokens:
     * - Keywords/identifiers (sequences of word characters: a-z, A-Z, 0-9, _)
     * - Numbers (including decimals and scientific notation)
     * - String literals (single or double quoted)
     * - Operators and punctuation
     * - Whitespace is preserved but NOT included in tokens array
     * 
     * Returns: array of { text, type } where type is 'code' (selectable) or 'whitespace' (not selectable)
     */
    const tokens = [];
    let i = 0;
    const len = code.length;

    while (i < len) {
        const char = code[i];
        
        // Whitespace (spaces, tabs, newlines) - preserved but not selectable
        if (/\s/.test(char)) {
            let whitespace = '';
            while (i < len && /\s/.test(code[i])) {
                whitespace += code[i];
                i++;
            }
            tokens.push({ text: whitespace, type: 'whitespace' });
            continue;
        }
        
        // String literals (double quotes)
        if (char === '"') {
            let str = '"';
            i++;
            while (i < len && code[i] !== '"') {
                if (code[i] === '\\') {
                    str += code[i] + (i + 1 < len ? code[i + 1] : '');
                    i += 2;
                } else {
                    str += code[i];
                    i++;
                }
            }
            if (i < len) str += code[i++];
            tokens.push({ text: str, type: 'code' });
            continue;
        }
        
        // String literals (single quotes / character literals)
        if (char === "'") {
            let str = "'";
            i++;
            while (i < len && code[i] !== "'") {
                if (code[i] === '\\') {
                    str += code[i] + (i + 1 < len ? code[i + 1] : '');
                    i += 2;
                } else {
                    str += code[i];
                    i++;
                }
            }
            if (i < len) str += code[i++];
            tokens.push({ text: str, type: 'code' });
            continue;
        }
        
        // Numbers (including decimals)
        if (/\d/.test(char)) {
            let num = '';
            while (i < len && /[\d.]/.test(code[i])) {
                num += code[i];
                i++;
            }
            // Handle scientific notation (e.g., 1e-5)
            if (i < len && /[eE]/.test(code[i])) {
                num += code[i++];
                if (i < len && /[+-]/.test(code[i])) {
                    num += code[i++];
                }
                while (i < len && /\d/.test(code[i])) {
                    num += code[i++];
                }
            }
            tokens.push({ text: num, type: 'code' });
            continue;
        }
        
        // Identifiers and keywords (word characters)
        if (/[a-zA-Z_$]/.test(char)) {
            let ident = '';
            while (i < len && /[a-zA-Z0-9_$]/.test(code[i])) {
                ident += code[i];
                i++;
            }
            tokens.push({ text: ident, type: 'code' });
            continue;
        }
        
        // Multi-character operators
        if (i + 1 < len) {
            const twoChar = code.substr(i, 2);
            if (['==', '!=', '<=', '>=', '&&', '||', '++', '--', '<<', '>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(twoChar)) {
                tokens.push({ text: twoChar, type: 'code' });
                i += 2;
                continue;
            }
        }
        
        // Single character operators and punctuation
        tokens.push({ text: char, type: 'code' });
        i++;
    }

    return tokens;
}

function parseJavaCode(raw) {
    /**
     * Parse exercise code with bugs marked as [[...]].
     * In the new format:
     * - Only bugs are wrapped with [[ ]]
     * - All wrapped tokens are considered bugs
     * - Process: Extract bug markers → Remove markers → Tokenize clean code → Match bugs → Build HTML
     */

    // Step 1: Extract bug markers from [[...]] patterns
    const bugMarkers = [];
    const cleanCode = raw.replace(/\[\[(.*?)\]\]/g, (match, content) => {
        const tokenText = content.trim();
        // In the new format, all wrapped tokens are bugs
        bugMarkers.push({ text: tokenText, isBug: true });
        // Return just the token text without markers
        return tokenText;
    });

    // Step 2: Tokenize the clean code
    const tokens = tokenizeCode(cleanCode);

    // Step 3: Match bug markers to tokens in order
    const answers = [];
    const userProgress = [];
    const codeTokens = tokens.filter(t => t.type === 'code');
    
    // Build answer array by matching tokens with tracked bugs
    let bugIndex = 0;
    codeTokens.forEach(token => {
        let isWrong = false;
        // Check if this token was marked as a bug in the original source
        if (bugIndex < bugMarkers.length && bugMarkers[bugIndex].text === token.text) {
            isWrong = bugMarkers[bugIndex].isBug;
            bugIndex++;
        }
        answers.push({ token: token.text, isWrong });
        userProgress.push(false);
    });

    // Step 4: Build HTML with all tokens selectable and whitespace preserved
    let html = '';
    let tokenIdx = 0;
    
    tokens.forEach(tok => {
        if (tok.type === 'whitespace') {
            // Preserve whitespace but escape HTML
            const escaped = tok.text
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
            html += escaped;
        } else {
            // Code token - make it selectable
            const escaped = tok.text
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
            html += `<label class="token-option" data-idx="${tokenIdx}"><input type="checkbox" data-idx="${tokenIdx}" onchange="toggleToken(${tokenIdx}, this)">${escaped}</label>`;
            tokenIdx++;
        }
    });

    const wrongCount = answers.filter(a => a.isWrong).length;
    return { html, answers, userProgress, wrongCount, lastScore: 0, locked: false, lastVerifiedAt: null };
}  

// Toggle a checkbox; enforce maximum selections equal to wrongCount and update selected counter
function toggleToken(index, checkbox) {
    if (!exerciseData[currentFile]) return;
    const data = exerciseData[currentFile];
    // Do not allow changing answers when exercise is locked (verified)
    if (data.locked) {
        const fb = document.getElementById('feedback');
        fb.textContent = 'This exercise is locked — click Reset Code to try again.';
        fb.style.color = 'var(--error)';
        setTimeout(() => { fb.textContent = ''; }, 2200);
        checkbox.checked = !!data.userProgress[index];
        return;
    }
    const max = data.wrongCount || 0;
    const currentlySelected = data.userProgress.reduce((s, v) => s + (v ? 1 : 0), 0);

    if (checkbox.checked) {
        if (currentlySelected >= max) {
            // prevent selecting more than allowed
            checkbox.checked = false;
            const fb = document.getElementById('feedback');
            fb.textContent = `Select up to ${max} token${max === 1 ? '' : 's'}.`;
            fb.style.color = 'var(--error)';
            setTimeout(() => { fb.textContent = ''; }, 2200);
            return;
        }
        data.userProgress[index] = true;
        checkbox.parentElement.classList.add('selected');
    } else {
        data.userProgress[index] = false;
        checkbox.parentElement.classList.remove('selected');
    }

    // update selected count UI
    const selectedCount = data.userProgress.reduce((s, v) => s + (v ? 1 : 0), 0);
    const selectedEl = document.getElementById('selectedCount');
    if (selectedEl) selectedEl.textContent = selectedCount;

    // disable unchecked boxes when selection limit reached
    const checks = document.querySelectorAll('.token-option input[type="checkbox"]');
    checks.forEach(cb => {
        if (!cb.checked) {
            cb.disabled = (selectedCount >= max);
            cb.parentElement.classList.toggle('disabled', cb.disabled);
        } else {
            cb.disabled = false;
            cb.parentElement.classList.remove('disabled');
        }
    });

    saveExamState();
}

function switchExercise(name, el) {
    currentFile = name;
    document.querySelectorAll('.sidebar li').forEach(l => l.classList.remove('active'));
    el.classList.add('active');
    
    document.getElementById('currentFileName').textContent = name;
    const display = document.getElementById('codeDisplay');
    display.innerHTML = exerciseData[name].html;

    // Show max tokens in header
    const max = exerciseData[name].wrongCount || 0;
    const maxEl = document.getElementById('maxTokens');
    const maxLabel = document.getElementById('maxTokensLabel');
    if (maxEl) maxEl.textContent = max;
    if (maxLabel) maxLabel.textContent = max;

    // Restore previous checkbox selections
    const checks = display.querySelectorAll('.token-option input[type="checkbox"]');
    checks.forEach((input, idx) => {
        input.checked = !!exerciseData[name].userProgress[idx];
        if (input.checked) input.parentElement.classList.add('selected');
        else input.parentElement.classList.remove('selected');
    });

    // update selected counter UI
    const selectedCount = exerciseData[name].userProgress.reduce((s, v) => s + (v ? 1 : 0), 0);
    const selectedEl = document.getElementById('selectedCount');
    if (selectedEl) selectedEl.textContent = selectedCount;

    // If this exercise was already verified (including one restored from a persisted
    // exam session), reapply the correct/wrong visual markings.
    if (exerciseData[name].locked) {
        const answers = exerciseData[name].answers;
        checks.forEach((input, idx) => {
            const label = input.parentElement;
            const selected = input.checked;
            const isWrong = answers[idx] ? answers[idx].isWrong : false;
            label.classList.remove('wrong', 'correct');
            if (selected && !isWrong) label.classList.add('wrong');
            if (selected && isWrong) label.classList.add('correct');
        });
    }

    // Enforce disabling if max reached (or lock if exercise is verified)
    checks.forEach(cb => {
        if (!cb.checked) cb.disabled = (selectedCount >= max) || !!exerciseData[name].locked;
        cb.parentElement.classList.toggle('disabled', cb.disabled);
        // If exercise is locked, ensure label looks non-interactive
        if (exerciseData[name].locked) cb.parentElement.classList.add('disabled');
    });

    // Update Verify/Reset button based on lock state
    const verifyBtn = document.getElementById('verifyBtn');
    if (exerciseData[name].locked) {
        if (appMode === 'exam') {
            verifyBtn.textContent = 'Locked';
            verifyBtn.disabled = true;
        } else {
            verifyBtn.textContent = 'Reset Code';
            verifyBtn.disabled = false;
        }
    } else {
        verifyBtn.textContent = 'Verify Code';
        verifyBtn.disabled = false;
    }

    document.getElementById('feedback').textContent = "";
} 

function checkAnswers() {
    const data = exerciseData[currentFile];
    const answers = data.answers;
    let score = 0;

    const inputs = document.querySelectorAll('.token-option input[type="checkbox"]');
    inputs.forEach((input, idx) => {
        const label = input.parentElement;
        // clear previous indicators (wrong/correct)
        label.classList.remove('wrong', 'correct');
        const selected = input.checked;
        const isWrong = answers[idx].isWrong;

        // mark incorrectly selected tokens (selected but not actually wrong)
        if (selected && !isWrong) label.classList.add('wrong');
        // mark selected tokens that are correctly identified as wrong with a strong visual
        if (selected && isWrong) {
            label.classList.add('correct');
            score++;
        }
    });

    // Update Sidebar Score and lock exercise
    const safeId = currentFile.replace(/\./g, '-');
    const scoreSpan = document.getElementById(`score-${safeId}`);
    scoreSpan.textContent = `${score}/${data.wrongCount}`;

    // store last score and lock
    data.lastScore = score;
    data.locked = true;
    data.lastVerifiedAt = new Date().toISOString();

    // disable all inputs for this exercise
    const checks = document.querySelectorAll('.token-option input[type="checkbox"]');
    checks.forEach(cb => {
        cb.disabled = true;
        cb.parentElement.classList.add('disabled');
    });

    // switch Verify -> Reset
    const verifyBtn = document.getElementById('verifyBtn');
    if (verifyBtn) {
        if (appMode === 'exam') {
            verifyBtn.textContent = 'Locked';
            verifyBtn.disabled = true;
        } else {
            verifyBtn.textContent = 'Reset Code';
            verifyBtn.disabled = false;
        }
    }

    // Update total accumulated score
    updateTotalScore();

    const msg = document.getElementById('feedback');
    if (score === data.wrongCount) {
        scoreSpan.classList.add('completed-score');
        msg.textContent = "✨ Perfect! Activity Complete! ✨";
        msg.style.color = "var(--secondary)";
        // smaller celebratory burst for a single exercise
        triggerConfetti({ type: 'exercise' });
    } else {
        scoreSpan.classList.remove('completed-score');
        msg.textContent = `Progress: ${score}/${data.wrongCount} correct.`;
        msg.style.color = "var(--text-main)";
    }

    saveExamState();
} 

function triggerConfetti(options = {}) {
    // options: { type: 'exercise' | 'all', colors?: [], particleCount?: number }
    const type = options.type || 'exercise';

    if (type === 'exercise') {
        confetti({
            particleCount: options.particleCount || 80,
            spread: options.spread || 60,
            origin: options.origin || { y: 0.6 },
            colors: options.colors || ['#03dac6', '#ffca28']
        });
        // small follow-up burst
        setTimeout(() => {
            confetti({
                particleCount: 40,
                spread: 40,
                origin: { y: 0.7 },
                colors: ['#6200ee']
            });
        }, 250);
    } else if (type === 'all') {
        // Big multi-burst celebration for completing all exercises
        const bigBurst = (pCount, spread, delay, col) => setTimeout(() => confetti({ particleCount: pCount, spread, origin: { y: 0.6 }, colors: col }), delay);
        bigBurst(options.particleCount || 500, options.spread || 140, 0, options.colors || ['#6200ee', '#03dac6', '#ffca28']);
        bigBurst(300, 120, 400, ['#ffca28', '#03dac6']);
        bigBurst(200, 100, 800, ['#6200ee']);
    } else {
        // fallback to default small burst
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    }
}

function exportProgress() {
    let csv = "Student,Exercise,Max Score,Score,Verified At\n";
    for (const file in exerciseData) {
        const d = exerciseData[file];
        const tmax = d.wrongCount || 0;
        const score = d.lastScore || 0; // lastScore is set on verify, 0 if not verified
        const when = d.lastVerifiedAt || '';
        csv += `${currentUser},${file},${tmax},${score},${when}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentUser}_results.csv`;
    a.click();
}

// Show score modal; reason: 'complete' | 'time'
function showScoreModal(reason) {
    if (scoreModalShown) return;
    scoreModalShown = true;
    const totalCorrect = Array.from(Object.values(exerciseData)).reduce((s,d) => s + (d.lastScore||0), 0);
    const totalMax = Array.from(Object.values(exerciseData)).reduce((s,d) => s + (d.wrongCount||0), 0);
    const scoreEmail = document.getElementById('scoreEmail');
    const scoreBig = document.getElementById('scoreBig');
    const breakdown = document.getElementById('scoreBreakdown');
    if (scoreEmail) scoreEmail.textContent = currentUser || '';
    if (scoreBig) scoreBig.textContent = `${totalCorrect} / ${totalMax}`;
    if (breakdown) {
        let html = '';
        for (const f in exerciseData) {
            const d = exerciseData[f];
            html += `<div style="margin:6px 0;">${f.replace('.java','')}: ${d.lastScore||0}/${d.wrongCount||0}</div>`;
        }
        breakdown.innerHTML = html;
    }
    const m = document.getElementById('scoreModal'); if (m) m.style.display = 'flex';
}

function closeScoreModal() {
    const m = document.getElementById('scoreModal'); if (m) m.style.display = 'none';
}
