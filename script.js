document.addEventListener('DOMContentLoaded', () => {
    // --- Data Persistence Setup ---
    let savedSessions = localStorage.getItem('currentSessionsData');
    let sessionsData = [
        { historyId: null, items: [], memo: '', extraDiscount: 0 },
        { historyId: null, items: [], memo: '', extraDiscount: 0 },
        { historyId: null, items: [], memo: '', extraDiscount: 0 }
    ];

    if (savedSessions) {
        try {
            let parsed = JSON.parse(savedSessions);
            if (parsed && parsed.length === 3) sessionsData = parsed;
        } catch (e) { }
    }

    let currentTab = 0;
    let savedTab = localStorage.getItem('currentTab');
    if (savedTab !== null) {
        currentTab = parseInt(savedTab);
        if (isNaN(currentTab) || currentTab < 0 || currentTab > 2) currentTab = 0;
    }

    let items = sessionsData[currentTab].items;

    function saveSessionState() {
        localStorage.setItem('currentSessionsData', JSON.stringify(sessionsData));
        localStorage.setItem('currentTab', currentTab);
    }

    // --- UI Update & Time ---
    function updateCurrentTime() {
        const now = new Date();
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const ampm = now.getHours() >= 12 ? '오후' : '오전';
        let h = now.getHours() % 12 || 12;
        const min = now.getMinutes().toString().padStart(2, '0');
        document.getElementById('current-time-display').textContent =
            `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${days[now.getDay()]}요일, ${ampm} ${h}:${min}`;
    }
    setInterval(updateCurrentTime, 1000);
    updateCurrentTime();

    // --- Voice Recognition Setup ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isListening = false;
    let userStopped = false;
    let silenceTimer = null;
    let lastProcessedText = "";

    // Accumulators to fix Android duplication bugs
    let globalAccumulator = "";
    let sessionResultCount = 0;
    let lastFinalText = "";

    const micBtn = document.getElementById('mic-btn');
    const voiceStatus = document.getElementById('voice-status');
    const voiceTranscript = document.getElementById('voice-transcript');

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'ko-KR';
        recognition.interimResults = true;
        recognition.continuous = false;

        micBtn.addEventListener('click', () => {
            if (isListening) {
                userStopped = true;
                recognition.stop();
            } else {
                userStopped = false;
                lastProcessedText = "";
                globalAccumulator = "";
                lastFinalText = "";
                voiceTranscript.textContent = "";
                recognition.start();
            }
        });

        recognition.onstart = () => {
            isListening = true;
            sessionResultCount = 0;
            micBtn.classList.add('listening');
            voiceStatus.textContent = '듣고 있습니다... 언제든 멈추려면 버튼을 누르세요.';
        };

        recognition.onerror = (e) => {
            if (e.error === 'aborted' || e.error === 'no-speech') return;
            isListening = false;
            micBtn.classList.remove('listening');
            voiceStatus.textContent = '음성 인식 오류: ' + e.error;
        };

        recognition.onend = () => {
            isListening = false;
            micBtn.classList.remove('listening');
            if (userStopped) {
                voiceStatus.textContent = '마이크 버튼을 눌러 시작하세요';
                return;
            }
            // Mobile auto-restart
            setTimeout(() => {
                if (!isListening && !userStopped) {
                    try { recognition.start(); } catch (e) { }
                }
            }, 300);
        };

        recognition.onresult = (e) => {
            clearTimeout(silenceTimer);
            let interim = "";

            for (let i = sessionResultCount; i < e.results.length; i++) {
                if (e.results[i].isFinal) {
                    let text = e.results[i][0].transcript.trim();
                    // 안드로이드 중복 final 반환 버그 방지
                    if (text && text !== lastFinalText) {
                        globalAccumulator += text + " ";
                        lastFinalText = text;
                    }
                    sessionResultCount = i + 1;
                } else {
                    interim += e.results[i][0].transcript;
                }
            }

            let currentText = (globalAccumulator + interim).trim();
            voiceTranscript.textContent = currentText;

            silenceTimer = setTimeout(() => {
                if (currentText && currentText !== lastProcessedText) {
                    lastProcessedText = currentText;
                    processVoiceCommand(currentText);

                    // 초기화 및 재시작 유도
                    globalAccumulator = "";
                    lastFinalText = "";

                    // 처리 완료 후 깨끗한 상태로 다시 시작하기 위해 stop 호출
                    try { recognition.stop(); } catch (err) { }
                }
            }, 800); // 0.8 seconds silence triggers processing
        };

        try { recognition.start(); } catch (e) { }
    } else {
        voiceStatus.textContent = "현재 브라우저는 음성 인식을 지원하지 않습니다.";
    }

    // 모바일 화면 꺼짐/켜짐 복구
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === 'visible') {
            if (!userStopped && recognition) {
                try { recognition.stop(); } catch (e) { }
                setTimeout(() => {
                    if (!isListening) {
                        try { recognition.start(); } catch (e) {
                            initSpeechRecognition();
                            try { recognition.start(); } catch (e2) { }
                        }
                    }
                }, 300);
            }
        }
    });

    // --- Command Processing ---
    function processVoiceCommand(text) {
        text = text.replace(/\./g, '').trim();

        if (text.includes('초기화') || text.includes('전부 지워')) {
            resetCurrentTab();
            return;
        }

        if (text.includes('입력 완료') || text.includes('계산 완료')) {
            saveHistory();
            return;
        }

        if (text.includes('수정') || text.includes('변경') || text.includes('말고')) {
            applyCorrections(text);
            return;
        }

        let subItems = splitIntoSubItems(text);
        let added = false;
        subItems.forEach(str => {
            let item = parseSingleItem(str);
            if (item) {
                items.push(item);
                added = true;
            }
        });

        if (added) renderItems();
    }

    function resetCurrentTab() {
        if (!confirm("현재 화면을 정말 초기화할까요?")) return;

        sessionsData[currentTab].items = [];
        sessionsData[currentTab].memo = '';
        sessionsData[currentTab].extraDiscount = 0;
        sessionsData[currentTab].historyId = null;
        items = sessionsData[currentTab].items;

        document.getElementById('session-memo').value = '';
        document.getElementById('extra-discount').value = '';
        renderItems();
        voiceTranscript.textContent = '';
    }

    function applyCorrections(text) {
        // "3500원 말고 4000원으로 수정해줘" 형태
        const modifyRegex = /([0-9가-힣]+)\s*원\s*말고\s*([0-9가-힣]+)\s*원/g;
        let match;
        let corrected = false;
        while ((match = modifyRegex.exec(text)) !== null) {
            let oldAmt = parseKoreanNumberString(match[1]);
            let newAmt = parseKoreanNumberString(match[2]);
            if (!isNaN(oldAmt) && !isNaN(newAmt)) {
                // 뒤에서부터 찾아서 변경 (가장 최근 항목)
                for (let i = items.length - 1; i >= 0; i--) {
                    if (items[i].amount === oldAmt) {
                        items[i].amount = newAmt;
                        corrected = true;
                        break;
                    }
                }
            }
        }

        // "아니 3개 말고 5개" 등 수량 수정
        const qtyRegex = /([0-9가-힣]+)\s*개\s*말고\s*([0-9가-힣]+)\s*개/g;
        while ((match = qtyRegex.exec(text)) !== null) {
            let newQty = parseQuantity(match[2]);
            if (!isNaN(newQty) && items.length > 0) {
                // 가장 최근 항목 수량 변경
                items[items.length - 1].quantity = newQty;
                corrected = true;
            }
        }

        // "박카스를 쌍화탕으로 수정해줘" 등 항목명(메모) 수정
        const textRegex = /(.*?)[을를]\s+(.*?)(?:으)?로\s*(?:수정|변경)/g;
        while ((match = textRegex.exec(text)) !== null) {
            let oldMemo = match[1].trim();
            let newMemo = match[2].trim();
            for (let i = items.length - 1; i >= 0; i--) {
                if (items[i].memo === oldMemo || items[i].memo.includes(oldMemo)) {
                    items[i].memo = items[i].memo.replace(oldMemo, newMemo);
                    corrected = true;
                    break;
                }
            }
        }

        if (corrected) renderItems();
    }

    function splitIntoSubItems(str) {
        let parts = str.split('원');
        if (parts.length <= 1) return [str];

        let results = [];
        for (let i = 0; i < parts.length - 1; i++) {
            let chunk = parts[i] + '원';
            let next = (parts[i + 1] || '').trim();
            let qtyMatch = next.match(/^([0-9가-힣]+)\s*개/);
            if (qtyMatch) {
                chunk += ' ' + qtyMatch[0];
                parts[i + 1] = next.slice(qtyMatch[0].length);
            } else {
                let multMatch = next.match(/^곱하기\s*([0-9가-힣]+)/);
                if (multMatch) {
                    chunk += ' ' + multMatch[0];
                    parts[i + 1] = next.slice(multMatch[0].length);
                }
            }
            if (chunk.trim()) results.push(chunk.trim());
        }
        if (parts[parts.length - 1].trim()) {
            results.push(parts[parts.length - 1].trim());
        }
        return results;
    }

    function parseSingleItem(str) {
        str = str.trim();
        if (!str) return null;

        let memo = '';
        let amountStr = '';
        let qtyStr = '1';

        // 1. 수량 추출 ("N개" 또는 "곱하기 N")
        let qtyMatch = str.match(/\s*(?:([0-9가-힣]+)\s*개|곱하기\s*([0-9가-힣]+))$/);
        if (qtyMatch) {
            qtyStr = qtyMatch[1] || qtyMatch[2];
            str = str.slice(0, -qtyMatch[0].length).trim();
        }

        // 2. "원" 제거
        if (str.endsWith('원')) {
            str = str.slice(0, -1).trim();
        }

        // 3. 띄어쓰기 기준으로 토큰 분리 후, 뒤에서부터 '금액'에 해당하는 글자인지 확인
        let parts = str.split(/\s+/);
        let amountParts = [];
        let memoParts = [];

        // 금액에 쓰이는 유효한 문자 (숫자, 쉼표, 한국어 숫자/단위)
        const amountRegex = /^[\d,일이삼사오육칠팔구영공십백천만억조]+$/;

        for (let i = parts.length - 1; i >= 0; i--) {
            if (amountRegex.test(parts[i])) {
                amountParts.unshift(parts[i]);
            } else {
                // 금액이 아닌 단어를 만나면 그 앞은 전부 메모로 취급
                memoParts = parts.slice(0, i + 1);
                break;
            }
        }

        if (amountParts.length > 0) {
            amountStr = amountParts.join('');
            memo = memoParts.join(' ').replace(/^(그리고|더하기|하고|이랑|과|와|,|\+)\s*/g, '').trim();
        } else {
            return null; // 금액이 없으면 무효
        }

        let amount = parseKoreanNumberString(amountStr);
        let qty = parseQuantity(qtyStr);

        if (!isNaN(amount) && amount !== 0) {
            return {
                id: Date.now() + Math.random(),
                amount: amount,
                quantity: qty,
                memo: memo,
                discountRate: 0,
                itemDiscount: 0
            };
        }
        return null;
    }

    // --- Number Parsing Utilities ---
    function parseKoreanNumberString(str) {
        if (!str) return NaN;
        str = str.replace(/원/g, '').replace(/,/g, '').trim();

        if (/^\d+$/.test(str.replace(/\s+/g, ''))) {
            let parts = str.split(/\s+/);
            return parts.reduce((sum, p) => sum + parseInt(p, 10), 0);
        }

        const units = { '십': 10, '백': 100, '천': 1000 };
        const largeUnits = { '만': 10000, '억': 100000000, '조': 1000000000000 };
        const korNums = { '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '칠': 7, '팔': 8, '구': 9, '영': 0, '공': 0 };

        let total = 0;
        let currentPart = 0;
        let currentNum = 0;
        let hasNum = false;

        let i = 0;
        while (i < str.length) {
            let char = str[i];
            if (/\s/.test(char)) { i++; continue; }

            if (/\d/.test(char)) {
                let numStr = char;
                while (i + 1 < str.length && /\d/.test(str[i + 1])) {
                    numStr += str[i + 1];
                    i++;
                }
                if (hasNum) currentPart += currentNum;
                currentNum = parseInt(numStr, 10);
                hasNum = true;
            } else if (korNums[char] !== undefined) {
                if (hasNum) currentPart += currentNum;
                currentNum = korNums[char];
                hasNum = true;
            } else if (units[char]) {
                let val = hasNum ? currentNum : 1;
                currentPart += val * units[char];
                currentNum = 0;
                hasNum = false;
            } else if (largeUnits[char]) {
                if (!hasNum && currentPart === 0) currentPart = 1;
                else if (hasNum) currentPart += currentNum;
                total += currentPart * largeUnits[char];
                currentPart = 0;
                currentNum = 0;
                hasNum = false;
            }
            i++;
        }
        if (hasNum) currentPart += currentNum;
        total += currentPart;
        return total;
    }

    function parseQuantity(str) {
        if (!str) return 1;
        str = str.replace(/\s+/g, '').replace('개', '');
        if (/^\d+$/.test(str)) return parseInt(str, 10);
        const korMap = { '한': 1, '하나': 1, '일': 1, '두': 2, '둘': 2, '이': 2, '세': 3, '셋': 3, '삼': 3, '네': 4, '넷': 4, '사': 4, '다섯': 5, '오': 5, '여섯': 6, '육': 6, '일곱': 7, '칠': 7, '여덟': 8, '팔': 8, '아홉': 9, '구': 9, '열': 10, '십': 10 };
        return korMap[str] || 1;
    }

    // --- Rendering ---
    function renderItems() {
        const tbody = document.getElementById('receipt-body');
        tbody.innerHTML = '';

        let itemsTotal = 0;

        items.forEach((item, index) => {
            let rowTotal = (item.amount * item.quantity) - (item.itemDiscount || 0);
            itemsTotal += rowTotal;

            let qtyColorStyle = item.quantity > 1 ? 'color: var(--danger);' : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center; font-weight: bold; color: var(--text-mut); font-size: 11px;">${index + 1}</td>
                <td style="text-align: center;"><input type="text" class="row-amount num-input" data-id="${item.id}" value="${item.amount.toLocaleString()}"></td>
                <td style="text-align: center;">
                    <div class="qty-control">
                        <button class="qty-btn qty-minus" data-id="${item.id}">-</button>
                        <input type="number" class="row-qty qty-input" data-id="${item.id}" value="${item.quantity}" min="0" style="${qtyColorStyle}">
                        <button class="qty-btn qty-plus" data-id="${item.id}">+</button>
                    </div>
                </td>
                <td class="row-total item-total-btn" data-id="${item.id}" style="cursor: pointer; text-decoration: underline; text-decoration-color: #cbd5e1; text-underline-offset: 4px; text-align: center;" title="항목 할인 설정">
                    ${rowTotal.toLocaleString()}
                    ${(item.itemDiscount > 0) ? `<br><span style="color:var(--danger); font-size:11px; font-weight:bold;">(-${item.itemDiscount.toLocaleString()})</span>` : ''}
                </td>
                <td style="text-align: center;"><input type="text" class="row-memo" data-id="${item.id}" value="${item.memo}"></td>
                <td style="text-align: center;"><button class="del-row-btn" data-id="${item.id}"><i class="fa-solid fa-trash"></i></button></td>
            `;
            tbody.appendChild(tr);
        });

        let extraDiscount = sessionsData[currentTab].extraDiscount || 0;
        let finalTotal = itemsTotal - extraDiscount;
        document.getElementById('total-sum').textContent = finalTotal.toLocaleString() + '원';

        const appliedDiscText = document.getElementById('applied-discount-text');
        if (extraDiscount > 0) {
            appliedDiscText.textContent = `(-${extraDiscount.toLocaleString()}원 할인됨)`;
        } else {
            appliedDiscText.textContent = '';
        }

        // Event listeners for dynamic inputs
        document.querySelectorAll('.qty-minus').forEach(btn => btn.addEventListener('click', e => {
            let id = e.target.dataset.id;
            let item = items.find(i => i.id == id);
            if (item && item.quantity > 0) { item.quantity--; renderItems(); }
        }));
        document.querySelectorAll('.qty-plus').forEach(btn => btn.addEventListener('click', e => {
            let id = e.target.dataset.id;
            let item = items.find(i => i.id == id);
            if (item) { item.quantity++; renderItems(); }
        }));
        document.querySelectorAll('.del-row-btn').forEach(btn => btn.addEventListener('click', e => {
            let id = e.target.closest('button').dataset.id;
            items = items.filter(i => i.id != id);
            sessionsData[currentTab].items = items;
            renderItems();
        }));
        document.querySelectorAll('.row-amount').forEach(inp => inp.addEventListener('change', e => {
            let id = e.target.dataset.id;
            let val = parseInt(e.target.value.replace(/,/g, '')) || 0;
            let item = items.find(i => i.id == id);
            if (item) { item.amount = val; renderItems(); }
        }));
        document.querySelectorAll('.row-memo').forEach(inp => inp.addEventListener('change', e => {
            let id = e.target.dataset.id;
            let item = items.find(i => i.id == id);
            if (item) item.memo = e.target.value;
            saveSessionState();
        }));
        document.querySelectorAll('.row-qty').forEach(inp => inp.addEventListener('change', e => {
            let id = e.target.dataset.id;
            let val = parseInt(e.target.value) || 0;
            let item = items.find(i => i.id == id);
            if (item) { item.quantity = val; renderItems(); }
        }));

        saveSessionState();
    }

    // 초기 렌더링 및 UI 설정 (저장된 탭 복구)
    function initializeTabs() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns[0].style.backgroundColor = '#ffffff';
        tabBtns[1].style.backgroundColor = '#fce7f3';
        tabBtns[2].style.backgroundColor = '#dcfce7';

        tabBtns.forEach(b => {
            b.classList.remove('active');
            b.style.color = 'var(--text-mut)';
            if (parseInt(b.dataset.tab) === currentTab) {
                b.classList.add('active');
                b.style.color = 'var(--primary)';
            }
        });

        const panel = document.getElementById('receipt-panel');
        const footer = document.querySelector('.receipt-footer');
        if (currentTab === 0) {
            panel.style.backgroundColor = '#ffffff';
            footer.style.backgroundColor = '#f8fafc';
        } else if (currentTab === 1) {
            panel.style.backgroundColor = '#fce7f3';
            footer.style.backgroundColor = '#fce7f3';
        } else if (currentTab === 2) {
            panel.style.backgroundColor = '#dcfce7';
            footer.style.backgroundColor = '#dcfce7';
        }

        document.getElementById('session-memo').value = sessionsData[currentTab].memo;
        let ed = sessionsData[currentTab].extraDiscount || 0;
        document.getElementById('extra-discount').value = ed > 0 ? ed.toLocaleString() : '';

        renderItems();
    }
    initializeTabs();

    // --- Buttons & Interactions ---
    document.getElementById('reset-btn').addEventListener('click', resetCurrentTab);

    document.getElementById('save-btn').addEventListener('click', saveHistory);

    function saveHistory() {
        if (items.length === 0) return;
        const now = new Date();
        let history = JSON.parse(localStorage.getItem('calcHistory') || '[]');

        let total = items.reduce((acc, it) => acc + (it.amount * it.quantity), 0) - (sessionsData[currentTab].extraDiscount || 0);
        let histId = sessionsData[currentTab].historyId;

        if (histId) {
            let existing = history.find(s => s.id === histId);
            if (existing) {
                existing.updatedAt = now.getTime();
                existing.items = JSON.parse(JSON.stringify(items));
                existing.total = total;
                existing.memo = document.getElementById('session-memo').value;
                existing.extraDiscount = sessionsData[currentTab].extraDiscount || 0;
            } else {
                createNewHistory(history, now, total);
            }
        } else {
            createNewHistory(history, now, total);
        }

        // Keep only latest 30 records
        if (history.length > 30) {
            history.sort((a, b) => a.id - b.id);
            history = history.slice(history.length - 30);
        }

        localStorage.setItem('calcHistory', JSON.stringify(history));

        // Reset current
        items = [];
        sessionsData[currentTab].items = items;
        sessionsData[currentTab].memo = '';
        sessionsData[currentTab].extraDiscount = 0;
        sessionsData[currentTab].historyId = null;
        document.getElementById('session-memo').value = '';
        document.getElementById('extra-discount').value = '';
        renderItems();
        alert('저장 완료되었습니다.');
    }

    function createNewHistory(history, now, total) {
        const session = {
            id: now.getTime(),
            createdAt: now.getTime(),
            updatedAt: now.getTime(),
            items: JSON.parse(JSON.stringify(items)),
            total: total,
            memo: document.getElementById('session-memo').value,
            extraDiscount: sessionsData[currentTab].extraDiscount || 0
        };
        history.push(session);
    }

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            currentTab = parseInt(e.target.dataset.tab);
            items = sessionsData[currentTab].items;
            initializeTabs();
        });
    });

    const extraInput = document.getElementById('extra-discount');
    extraInput.addEventListener('input', (e) => {
        let val = parseInt(e.target.value.replace(/,/g, '')) || 0;
        e.target.value = val > 0 ? val.toLocaleString() : '';
    });

    document.getElementById('apply-discount-btn').addEventListener('click', () => {
        let val = parseInt(extraInput.value.replace(/,/g, '')) || 0;
        sessionsData[currentTab].extraDiscount = val;
        renderItems();
    });

    document.getElementById('cancel-discount-btn').addEventListener('click', () => {
        extraInput.value = '';
        sessionsData[currentTab].extraDiscount = 0;
        renderItems();
    });

    // (Overall discount logic removed as requested)

    document.getElementById('session-memo').addEventListener('input', (e) => {
        sessionsData[currentTab].memo = e.target.value;
        saveSessionState();
    });

    // --- History Modal ---

    document.getElementById('close-modal-btn').addEventListener('click', () => {
        document.getElementById('history-modal').classList.remove('active');
    });

    document.getElementById('hist-search-btn').addEventListener('click', renderHistory);

    function renderHistory() {
        const list = document.getElementById('history-list');
        let history = JSON.parse(localStorage.getItem('calcHistory') || '[]');

        const dtStart = document.getElementById('hist-datetime-start').value;
        const dtEnd = document.getElementById('hist-datetime-end').value;

        if (dtStart && dtEnd) {
            const startLimit = new Date(dtStart).getTime();
            const endLimit = new Date(dtEnd).getTime();
            history = history.filter(s => s.id >= startLimit && s.id <= endLimit);
        }

        if (history.length === 0) {
            list.innerHTML = '<p class="empty-msg">기록이 없습니다.</p>';
            document.getElementById('hist-select-all').checked = false;
            return;
        }

        history.sort((a, b) => b.id - a.id);

        let html = '';
        history.forEach(session => {
            const created = new Date(session.createdAt || session.id).toLocaleString();
            const updatedStr = session.updatedAt && session.updatedAt !== (session.createdAt || session.id)
                ? `<span style="font-size:11px; color:#f59e0b; margin-left:5px;">(수정: ${new Date(session.updatedAt).toLocaleString()})</span>`
                : '';

            html += `
            <div class="history-card" style="border:1px solid #e2e8f0; margin-bottom:10px; padding:10px; border-radius:8px; background: white;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:8px; margin-bottom:8px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="checkbox" class="hist-checkbox" data-id="${session.id}">
                        <strong style="font-size:13px;">${created}${updatedStr}</strong>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <strong style="color:#3b82f6;">${session.total.toLocaleString()}원</strong>
                        <button class="load-hist-btn" data-id="${session.id}" style="background:#3b82f6; color:white; border:none; border-radius:4px; padding:4px 8px; font-size:12px; cursor:pointer;">불러오기</button>
                    </div>
                </div>
                ${session.memo ? `<div style="font-size:13px; color:#64748b; margin-bottom:8px;"><i class="fa-solid fa-note-sticky"></i> ${session.memo}</div>` : ''}
                <div style="font-size:13px;">
                    ${session.items.map(it => `
                        <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                            <span>${it.memo} ${it.amount.toLocaleString()}원 × ${it.quantity}</span>
                            <span>${(it.amount * it.quantity).toLocaleString()}원</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            `;
        });
        list.innerHTML = html;

        // Event listeners for history actions
        document.querySelectorAll('.load-hist-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                let id = parseInt(e.target.dataset.id);
                loadHistoryToTab(id);
            });
        });

        // Handle individual checkbox change to update 'select all'
        document.querySelectorAll('.hist-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                let allChecked = Array.from(document.querySelectorAll('.hist-checkbox')).every(c => c.checked);
                document.getElementById('hist-select-all').checked = allChecked;
            });
        });
    }

    function loadHistoryToTab(id) {
        let history = JSON.parse(localStorage.getItem('calcHistory') || '[]');
        let session = history.find(s => s.id === id);
        if (session) {
            sessionsData[currentTab].items = JSON.parse(JSON.stringify(session.items));
            sessionsData[currentTab].memo = session.memo || '';
            sessionsData[currentTab].extraDiscount = session.extraDiscount || 0;
            sessionsData[currentTab].historyId = id;
            items = sessionsData[currentTab].items;

            document.getElementById('history-modal').classList.remove('active');
            initializeTabs();
            alert('기록이 현재 화면으로 불러와졌습니다. 수정 후 저장하면 기존 기록이 업데이트됩니다.');
        }
    }

    document.getElementById('hist-select-all').addEventListener('change', (e) => {
        let isChecked = e.target.checked;
        document.querySelectorAll('.hist-checkbox').forEach(cb => {
            cb.checked = isChecked;
        });
    });

    document.getElementById('hist-delete-selected-btn').addEventListener('click', () => {
        let selectedIds = Array.from(document.querySelectorAll('.hist-checkbox:checked')).map(cb => parseInt(cb.dataset.id));
        if (selectedIds.length === 0) {
            alert('삭제할 항목을 선택해주세요.');
            return;
        }
        if (confirm(`선택한 ${selectedIds.length}개의 기록을 삭제하시겠습니까?`)) {
            let history = JSON.parse(localStorage.getItem('calcHistory') || '[]');
            history = history.filter(s => !selectedIds.includes(s.id));
            localStorage.setItem('calcHistory', JSON.stringify(history));
            renderHistory();
        }
    });

    // --- Side Menu & Modals ---
    document.getElementById('menu-btn') && document.getElementById('menu-btn').addEventListener('click', () => {
        document.getElementById('side-menu-overlay').style.display = 'block';
        document.getElementById('side-menu').style.right = '0';
    });

    function closeMenu() {
        document.getElementById('side-menu').style.right = '-300px';
        setTimeout(() => {
            document.getElementById('side-menu-overlay').style.display = 'none';
        }, 300);
    }
    document.getElementById('close-menu-btn') && document.getElementById('close-menu-btn').addEventListener('click', closeMenu);
    document.getElementById('side-menu-overlay') && document.getElementById('side-menu-overlay').addEventListener('click', closeMenu);

    document.getElementById('menu-history-btn') && document.getElementById('menu-history-btn').addEventListener('click', () => {
        closeMenu();
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        const formatLocal = (d) => {
            const pad = n => n.toString().padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };

        document.getElementById('hist-datetime-start').value = formatLocal(startOfDay);
        document.getElementById('hist-datetime-end').value = formatLocal(endOfDay);
        renderHistory();
        document.getElementById('history-modal').classList.add('active');
    });

    document.getElementById('menu-manual-btn') && document.getElementById('menu-manual-btn').addEventListener('click', () => {
        closeMenu();
        document.getElementById('manual-modal').classList.add('active');
    });

    document.getElementById('close-manual-btn') && document.getElementById('close-manual-btn').addEventListener('click', () => {
        document.getElementById('manual-modal').classList.remove('active');
    });

    document.getElementById('menu-info-btn') && document.getElementById('menu-info-btn').addEventListener('click', () => {
        closeMenu();
        document.getElementById('info-modal').classList.add('active');
    });

    document.getElementById('close-info-btn') && document.getElementById('close-info-btn').addEventListener('click', () => {
        document.getElementById('info-modal').classList.remove('active');
    });

    // --- Item Discount Logic ---
    let currentDiscountItemId = null;
    document.getElementById('receipt-body').addEventListener('click', (e) => {
        const btn = e.target.closest('.item-total-btn');
        if (btn) {
            currentDiscountItemId = btn.dataset.id;
            document.getElementById('item-popup-discount-input').value = '';
            document.getElementById('item-discount-modal').classList.add('active');
        }
    });

    document.getElementById('close-item-discount-modal') && document.getElementById('close-item-discount-modal').addEventListener('click', () => {
        document.getElementById('item-discount-modal').classList.remove('active');
    });

    document.getElementById('item-discount-10-btn') && document.getElementById('item-discount-10-btn').addEventListener('click', () => {
        if (!currentDiscountItemId) return;
        let item = items.find(i => i.id == currentDiscountItemId);
        if (item) {
            let baseTotal = item.amount * item.quantity;
            item.itemDiscount = Math.floor(baseTotal * 0.1);
            renderItems();
            saveSessionState();
        }
        document.getElementById('item-discount-modal').classList.remove('active');
    });

    const itemPopupInput = document.getElementById('item-popup-discount-input');
    if (itemPopupInput) {
        itemPopupInput.addEventListener('input', (e) => {
            let val = parseInt(e.target.value.replace(/,/g, '')) || 0;
            e.target.value = val > 0 ? val.toLocaleString() : '';
        });
    }

    document.getElementById('item-popup-discount-apply') && document.getElementById('item-popup-discount-apply').addEventListener('click', () => {
        if (!currentDiscountItemId) return;
        let val = parseInt(itemPopupInput.value.replace(/,/g, '')) || 0;
        let item = items.find(i => i.id == currentDiscountItemId);
        if (item) {
            item.itemDiscount = val;
            renderItems();
            saveSessionState();
        }
        document.getElementById('item-discount-modal').classList.remove('active');
    });

    document.getElementById('item-discount-cancel-btn') && document.getElementById('item-discount-cancel-btn').addEventListener('click', () => {
        if (!currentDiscountItemId) return;
        let item = items.find(i => i.id == currentDiscountItemId);
        if (item) {
            item.itemDiscount = 0;
            renderItems();
            saveSessionState();
        }
        document.getElementById('item-discount-modal').classList.remove('active');
    });

});
