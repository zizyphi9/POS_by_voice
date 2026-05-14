document.addEventListener('DOMContentLoaded', () => {
    let sessionsData = [
        { items: [], memo: '', extraDiscount: 0 },
        { items: [], memo: '', extraDiscount: 0 },
        { items: [], memo: '', extraDiscount: 0 }
    ];
    let currentTab = 0;
    let items = sessionsData[currentTab].items;

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
        recognition.continuous = true;

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
            // Mobile auto-restart (Continuous mode work-around)
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
                    try { recognition.stop(); } catch (err) {}
                }
            }, 1200); // 1.2 seconds silence triggers processing
        };

        try { recognition.start(); } catch (e) {}
    } else {
        voiceStatus.textContent = "현재 브라우저는 음성 인식을 지원하지 않습니다.";
    }

    // --- Command Processing ---
    function processVoiceCommand(text) {
        text = text.replace(/\./g, '').trim();
        
        if (text.includes('초기화') || text.includes('전부 지워')) {
            resetToFirstScreen();
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

    function resetToFirstScreen() {
        // 첫 화면(결제 1 탭)으로 돌아가고 초기화
        currentTab = 0;
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.remove('active');
            b.style.color = 'var(--text-mut)';
            if (parseInt(b.dataset.tab) === 0) {
                b.classList.add('active');
                b.style.color = 'var(--primary)';
            }
        });
        const panel = document.getElementById('receipt-panel');
        panel.style.backgroundColor = '#ffffff';

        sessionsData[currentTab].items = [];
        sessionsData[currentTab].memo = '';
        sessionsData[currentTab].extraDiscount = 0;
        items = sessionsData[currentTab].items;
        document.getElementById('session-memo').value = '';
        renderItems();
        voiceTranscript.textContent = '';
        alert('모든 내용이 초기화되고 첫 화면으로 돌아왔습니다.');
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

        if (corrected) renderItems();
    }

    function splitIntoSubItems(str) {
        let parts = str.split('원');
        if (parts.length <= 1) return [str];
        
        let results = [];
        for (let i = 0; i < parts.length - 1; i++) {
            let chunk = parts[i] + '원';
            let next = (parts[i+1] || '').trim();
            let qtyMatch = next.match(/^([0-9가-힣]+)\s*개/);
            if (qtyMatch) {
                chunk += ' ' + qtyMatch[0];
                parts[i+1] = next.slice(qtyMatch[0].length);
            } else {
                let multMatch = next.match(/^곱하기\s*([0-9가-힣]+)/);
                if (multMatch) {
                    chunk += ' ' + multMatch[0];
                    parts[i+1] = next.slice(multMatch[0].length);
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

        // Match: (memo) (amount)원 (quantity)개
        let m = str.match(/^(.*?)\s*([0-9가-힣,]+)\s*원(?:\s*(?:([0-9가-힣]+)\s*개|곱하기\s*([0-9가-힣]+)))?$/);
        if (m) {
            memo = m[1].trim();
            amountStr = m[2];
            qtyStr = m[3] || m[4] || '1';
        } else {
            // "박카스 3500원" 
            m = str.match(/^(.*?)\s*([0-9가-힣,]+)\s*원$/);
            if (m) {
                memo = m[1].trim();
                amountStr = m[2];
            } else {
                return null;
            }
        }

        let amount = parseKoreanNumberString(amountStr);
        let qty = parseQuantity(qtyStr);

        if (!isNaN(amount) && amount !== 0) {
            return {
                id: Date.now() + Math.random(),
                amount: amount,
                quantity: qty,
                memo: memo,
                discountRate: 0
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
            let rowTotal = item.amount * item.quantity;
            itemsTotal += rowTotal;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center; font-weight: bold; color: var(--text-mut); font-size: 11px;">${index + 1}</td>
                <td><input type="text" class="row-amount num-input" data-id="${item.id}" value="${item.amount.toLocaleString()}"></td>
                <td style="text-align: center;">
                    <div class="qty-control">
                        <button class="qty-btn qty-minus" data-id="${item.id}">-</button>
                        <input type="number" class="row-qty qty-input" data-id="${item.id}" value="${item.quantity}" min="0">
                        <button class="qty-btn qty-plus" data-id="${item.id}">+</button>
                    </div>
                </td>
                <td class="row-total">${rowTotal.toLocaleString()}</td>
                <td><input type="text" class="row-memo" data-id="${item.id}" value="${item.memo}" placeholder="메모"></td>
                <td><button class="del-row-btn" data-id="${item.id}"><i class="fa-solid fa-trash"></i></button></td>
            `;
            tbody.appendChild(tr);
        });

        let extraDiscount = sessionsData[currentTab].extraDiscount || 0;
        let finalTotal = itemsTotal - extraDiscount;
        document.getElementById('total-sum').textContent = finalTotal.toLocaleString() + '원';

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
        }));
        document.querySelectorAll('.row-qty').forEach(inp => inp.addEventListener('change', e => {
            let id = e.target.dataset.id;
            let val = parseInt(e.target.value) || 0;
            let item = items.find(i => i.id == id);
            if (item) { item.quantity = val; renderItems(); }
        }));
    }

    // --- Buttons & Interactions ---
    document.getElementById('reset-btn').addEventListener('click', resetToFirstScreen);
    
    document.getElementById('save-btn').addEventListener('click', saveHistory);

    function saveHistory() {
        if (items.length === 0) return;
        const now = new Date();
        const session = {
            id: now.getTime(),
            date: now.toLocaleDateString(),
            time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            items: JSON.parse(JSON.stringify(items)),
            total: items.reduce((acc, it) => acc + (it.amount * it.quantity), 0) - (sessionsData[currentTab].extraDiscount || 0),
            memo: document.getElementById('session-memo').value,
            extraDiscount: sessionsData[currentTab].extraDiscount || 0
        };

        let history = JSON.parse(localStorage.getItem('calcHistory') || '[]');
        history.push(session);
        
        // Keep only latest 30 records
        if (history.length > 30) {
            history = history.slice(history.length - 30);
        }
        
        localStorage.setItem('calcHistory', JSON.stringify(history));
        
        // Reset current
        items = [];
        sessionsData[currentTab].items = items;
        sessionsData[currentTab].memo = '';
        sessionsData[currentTab].extraDiscount = 0;
        document.getElementById('session-memo').value = '';
        renderItems();
        alert('저장 완료되었습니다.');
    }

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('active');
                b.style.color = 'var(--text-mut)';
            });
            e.target.classList.add('active');
            e.target.style.color = 'var(--primary)';

            currentTab = parseInt(e.target.dataset.tab);
            items = sessionsData[currentTab].items;
            document.getElementById('session-memo').value = sessionsData[currentTab].memo;
            
            const panel = document.getElementById('receipt-panel');
            if (currentTab === 0) panel.style.backgroundColor = '#ffffff';
            else if (currentTab === 1) panel.style.backgroundColor = '#fdf2f8';
            else if (currentTab === 2) panel.style.backgroundColor = '#f0fdf4';

            renderItems();
        });
    });

    document.getElementById('extra-discount').addEventListener('input', (e) => {
        let val = parseInt(e.target.value.replace(/,/g, '')) || 0;
        e.target.value = val.toLocaleString();
        sessionsData[currentTab].extraDiscount = val;
        renderItems();
    });

    document.getElementById('session-memo').addEventListener('input', (e) => {
        sessionsData[currentTab].memo = e.target.value;
    });

    // --- History Modal ---
    document.getElementById('history-btn').addEventListener('click', () => {
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
            return;
        }

        history.sort((a, b) => b.id - a.id);
        
        let html = '';
        history.forEach(session => {
            html += `
            <div class="history-card" style="border:1px solid #e2e8f0; margin-bottom:10px; padding:10px; border-radius:8px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                    <strong>${new Date(session.id).toLocaleString()}</strong>
                    <strong style="color:#3b82f6;">${session.total.toLocaleString()}원</strong>
                </div>
                ${session.memo ? `<div style="font-size:13px; color:#64748b; margin-bottom:8px;"><i class="fa-solid fa-note-sticky"></i> ${session.memo}</div>` : ''}
                <div style="font-size:13px;">
                    ${session.items.map(it => `
                        <div style="display:flex; justify-content:space-between;">
                            <span>${it.memo} ${it.amount.toLocaleString()}원 × ${it.quantity}</span>
                            <span>${(it.amount * it.quantity).toLocaleString()}원</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            `;
        });
        list.innerHTML = html;
    }
});
