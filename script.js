document.addEventListener('DOMContentLoaded', () => {
    let sessionsData = [
        { items: [], memo: '', extraDiscount: 0 },
        { items: [], memo: '', extraDiscount: 0 },
        { items: [], memo: '', extraDiscount: 0 }
    ];
    let currentTab = 0;

    let items = sessionsData[currentTab].items;
    let activeInput = null;
    let isNewKeypadEntry = false;
    let originalValue = 0;

    function updateCurrentTime() {
        const now = new Date();
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        const d = now.getDate();
        const day = days[now.getDay()];
        let h = now.getHours();
        const min = now.getMinutes().toString().padStart(2, '0');
        const ampm = h >= 12 ? '오후' : '오전';
        if (h > 12) h -= 12;
        if (h === 0) h = 12;

        document.getElementById('current-time-display').textContent =
            `${y}년 ${m}월 ${d}일 ${day}요일, ${ampm} ${h}:${min}`;
    }
    setInterval(updateCurrentTime, 1000);
    updateCurrentTime();

    // --- 음성 인식 설정 ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isListening = false;
    let silenceTimer;

    const micBtn = document.getElementById('mic-btn');
    const voiceStatus = document.getElementById('voice-status');
    const voiceTranscript = document.getElementById('voice-transcript');

    let voiceTarget = null;
    let isProcessing = false;       // 처리 중 플래그
    let userStopped = false;        // 사용자가 직접 멈춘 경우
    let globalAccumulator = '';     // 세션 간 누적 텍스트 (안드로이드 세션 분리 대응)
    let sessionResultCount = 0;     // 현재 세션에서 이미 final로 처리한 결과 수
    let lastProcessedText = '';     // 직전에 처리한 텍스트 (완전 동일 중복 방지)

    // 모바일 감지
    const isMobile = /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'ko-KR';
        recognition.interimResults = true;
        recognition.continuous = true;

        micBtn.addEventListener('click', () => {
            try {
                if (isListening) {
                    userStopped = true;
                    clearTimeout(silenceTimer);
                    // 남아있는 텍스트 처리
                    let remaining = (globalAccumulator).trim();
                    if (remaining && remaining !== lastProcessedText) {
                        lastProcessedText = remaining;
                        processVoiceCommand(remaining, voiceTarget);
                    }
                    globalAccumulator = '';
                    sessionResultCount = 0;
                    voiceTarget = null;
                    recognition.stop();
                } else {
                    userStopped = false;
                    isProcessing = false;
                    lastProcessedText = '';
                    globalAccumulator = '';
                    sessionResultCount = 0;
                    voiceTarget = null;
                    voiceTranscript.textContent = '';
                    recognition.start();
                }
            } catch (e) {
                console.error("Mic toggle error:", e);
                if (e.name === 'InvalidStateError') {
                    isListening = true;
                    try { recognition.stop(); } catch (err) { }
                }
            }
        });

        recognition.onstart = () => {
            isListening = true;
            sessionResultCount = 0;  // 새 세션: final 카운트 초기화
            micBtn.classList.add('listening');
            if (!globalAccumulator) {
                voiceStatus.textContent = '듣고 있습니다... 언제든 멈추려면 버튼을 누르세요.';
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error === 'aborted' || event.error === 'no-speech') return;
            isListening = false;
            micBtn.classList.remove('listening');
            if (event.error === 'not-allowed') {
                voiceStatus.textContent = '마이크 권한이 차단되었습니다. 사이트 설정에서 허용해주세요.';
            } else if (event.error === 'network') {
                voiceStatus.textContent = '인터넷 연결을 확인해주세요.';
            } else {
                voiceStatus.textContent = '음성 인식 오류: ' + event.error;
            }
        };

        recognition.onend = () => {
            clearTimeout(silenceTimer);
            isListening = false;
            micBtn.classList.remove('listening');

            if (userStopped) {
                voiceStatus.textContent = '마이크 버튼을 눌러 시작하세요';
                globalAccumulator = '';
                voiceTranscript.textContent = '';
                isProcessing = false;
                return;
            }

            // 안드로이드에서 자연스럽게 세션이 끊긴 경우 → 자동 재시작
            // globalAccumulator는 유지하여 누적 계속
            setTimeout(() => {
                if (!userStopped && !isListening) {
                    sessionResultCount = 0;
                    try { recognition.start(); } catch (e) { }
                }
            }, 200);
        };

        recognition.onresult = (event) => {
            clearTimeout(silenceTimer);
            if (!voiceTarget) voiceTarget = activeInput;

            // sessionResultCount 이후의 NEW final 결과만 globalAccumulator에 추가
            let newFinals = '';
            for (let i = sessionResultCount; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    newFinals += event.results[i][0].transcript + ' ';
                    sessionResultCount = i + 1;
                }
            }
            if (newFinals) {
                globalAccumulator += newFinals;
            }

            // 현재 interim (아직 확정 안 된 결과)
            let interim = '';
            for (let i = sessionResultCount; i < event.results.length; i++) {
                if (!event.results[i].isFinal) {
                    interim += event.results[i][0].transcript;
                }
            }

            let currentText = (globalAccumulator + interim).trim();
            voiceTranscript.textContent = currentText;

            // 딜레이 결정 (모바일은 더 여유있게)
            let base = isMobile ? 1800 : 1200;
            let delay = base;
            if (currentText.endsWith('원') || currentText.endsWith('원 ')) {
                delay = isMobile ? 3000 : 2000;
            } else if (currentText.endsWith('더하기') || currentText.endsWith('+') || currentText.endsWith('하고')) {
                delay = 4000;
            } else if (voiceTarget && voiceTarget.classList.contains('row-memo')) {
                delay = isMobile ? 1500 : 800;
            }

            voiceStatus.textContent = '잠시 대기 중...';

            silenceTimer = setTimeout(() => {
                if (isProcessing) return;

                let textToProcess = (globalAccumulator + interim).trim();
                if (!textToProcess || textToProcess === lastProcessedText) return;

                isProcessing = true;
                lastProcessedText = textToProcess;

                // 처리 후 누적 초기화 (다음 발화를 위해)
                globalAccumulator = '';
                sessionResultCount = 0;
                voiceTranscript.textContent = '';
                let capturedTarget = voiceTarget;
                voiceTarget = null;

                processVoiceCommand(textToProcess, capturedTarget);

                isProcessing = false;
                voiceStatus.textContent = '듣고 있습니다... 언제든 멈추려면 버튼을 누르세요.';
            }, delay);
        };

        // 로드 시 자동 시작 시도
        try { recognition.start(); } catch (e) { }
    } else {
        voiceStatus.textContent = "현재 브라우저는 음성 인식을 지원하지 않습니다.";
    }

    // --- 명령어 분석 로직 ---
    function processVoiceCommand(text, targetInput = activeInput) {
        text = text.trim();
        if (!text) return;

        text = text.replace(/\.$/g, '').trim(); // Remove trailing period
        text = text.replace(/마침표$/g, '').trim();

        // 단가(금액) 칸이 포커스되어 있을 때 음성 인식으로 바로 수정
        if (targetInput && targetInput.classList.contains('row-amount')) {
            let numText = text;
            const amountRegex = /([0-9가-힣\s,]+?)을\s+([0-9가-힣\s,]+?)(?:으)?로/g;
            let match;
            let hasMatch = false;
            while ((match = amountRegex.exec(text)) !== null) {
                numText = match[2];
                hasMatch = true;
            }
            if (!hasMatch) {
                numText = text.replace(/아니/g, '').replace(/수정해줘/g, '').replace(/변경해줘/g, '').replace(/수정/g, '').replace(/변경/g, '');
            }

            let newAmt = parseKoreanNumberString(numText);
            if (!isNaN(newAmt)) {
                targetInput.value = newAmt.toLocaleString();
                updateItem(targetInput.dataset.id, 'amount', newAmt);
                targetInput.blur();
                if (activeInput === targetInput) activeInput = null;
                return;
            }
        }

        // 포커스된 입력창이 메모 필드(항목 메모 또는 전체 메모)일 경우 바로 내용 덮어쓰기/이어쓰기
        if (targetInput && (targetInput.classList.contains('row-memo') || targetInput.id === 'session-memo')) {
            let currentVal = targetInput.value.trim();
            targetInput.value = currentVal ? currentVal + ' ' + text : text;

            if (targetInput.classList.contains('row-memo')) {
                let item = items.find(i => i.id == targetInput.dataset.id);
                if (item) item.memo = targetInput.value;
            }
            targetInput.blur();
            if (activeInput === targetInput) activeInput = null;
            return;
        }

        // 입력 완료 / 마이크 끄기
        if (text.includes('입력 완료') || text.includes('입력완료') || text.includes('그만') || text.includes('정지') || text.includes('마이크 꺼') || text.includes('마이크 꺼줘') || text.includes('계산 완료')) {
            if (isListening && recognition) {
                try { recognition.stop(); } catch (e) { }
            }
            return;
        }

        // 전체 초기화
        if (text.includes('초기화') || text.includes('전부 지워')) {
            items = [];
            sessionsData[currentTab].items = items;
            sessionsData[currentTab].memo = '';
            sessionsData[currentTab].extraDiscount = 0;
            document.getElementById('session-memo').value = '';
            renderItems();
            return;
        }

        // 할인 명령 추출 및 텍스트에서 분리
        let pendingDiscounts = [];
        // 정규식 보강: "1번 10프로" 또는 "1번 10% 할인" 등 다양한 형태 지원
        const discountExtractRegex = /(?:([0-9]+|[일이삼사오육칠팔구십백천만]+)\s*번)\s*(?:([0-9가-힣]+)\s*(?:프로|퍼센트|%))(?:\s*할인)?/g;

        let match;
        while ((match = discountExtractRegex.exec(text)) !== null) {
            let idxNum = parseKoreanNumberString(match[1]);
            let percent = parseKoreanNumberString(match[2]);
            if (!isNaN(idxNum) && !isNaN(percent)) {
                pendingDiscounts.push({ index: idxNum, rate: percent });
            }
        }
        text = text.replace(discountExtractRegex, '').trim();

        // 수정/아니 명령
        if (text.includes('아니') || text.includes('수정') || text.includes('변경')) {
            applyCorrections(text);
            return;
        }

        // 수식 기호 변환 및 항목 추가
        if (text) {
            text = text.replace(/더하기/g, '+')
                .replace(/빼기/g, '-')
                .replace(/마이너스/g, '-');

            text = text.replace(/하면\??/g, '')
                .replace(/결과[는은]?/g, '')
                .replace(/얼마[야지]?/g, '')
                .replace(/은\??/g, '')
                .replace(/는\??/g, '');

            let tokens = text.match(/([+-]?)([^+-]+)/g);
            if (tokens) {
                tokens.forEach(token => {
                    let signMatch = token.match(/^[+-]/);
                    let sign = signMatch ? signMatch[0] : '+';
                    let rest = token.replace(/^[+-]/, '');

                    let matches = rest.match(/[^원]+원(?:\s*[0-9가-힣]+\s*개|\s*곱하기\s*[0-9가-힣]+)?/g);
                    if (!matches) {
                        matches = [rest];
                    }

                    matches.forEach(mStr => {
                        let newItem = parseSingleItem(mStr, sign);
                        if (newItem) {
                            items.push(newItem);
                        }
                    });
                });
            }
        }

        // 추출해둔 할인 명령을 생성된 항목(items)에 적용
        let discountApplied = false;
        pendingDiscounts.forEach(d => {
            if (d.index >= 1 && d.index <= items.length) {
                items[d.index - 1].discountRate = d.rate;
                discountApplied = true;
            }
        });

        // 텍스트가 남아서 추가되었거나 할인이 적용된 경우에만 UI 갱신
        if (text || discountApplied) {
            renderItems();
        }
    }

    function parseSingleItem(str, sign) {
        str = str.trim();
        if (!str) return null;

        let qtyStr = '1';
        let amountStr = str;
        let memo = '';

        let m = str.match(/(.*?)\s+(?:([0-9가-힣]+)\s*개|곱하기\s*([0-9가-힣]+))/);
        if (m) {
            amountStr = m[1];
            qtyStr = m[2] || m[3];
        }

        let numMatch = amountStr.match(/^(?:(.*?)\s+)?((?:\d|[일이삼사오육칠팔구영공십백천만억조])[일이삼사오육칠팔구영공십백천만억조\d\s,]*)(?:원)?$/);
        if (!numMatch && /\d/.test(amountStr)) {
            numMatch = amountStr.match(/^(.*?)([\d][일이삼사오육칠팔구영공십백천만억조\d\s,]*)(?:원)?$/);
        }

        if (numMatch) {
            if (numMatch[1]) memo = numMatch[1].trim().replace(/^,?\s*/, '').replace(/,$/, '').trim();
            amountStr = numMatch[2];
        } else {
            amountStr = amountStr.replace(/원$/, '').trim();
        }

        let amount = parseKoreanNumberString(amountStr);
        let qty = parseQuantity(qtyStr);

        if (!isNaN(amount) && amount !== 0) {
            if (sign === '-') amount = -amount;
            return {
                id: Date.now() + Math.random(),
                amount: amount,
                quantity: qty || 1,
                memo: memo
            };
        }
        return null;
    }

    function applyCorrections(text) {
        let corrected = false;

        // 1. 단가 수정 (예: 5만원을 6만원으로)
        const amountRegex = /([0-9가-힣\s,]+?)을\s+([0-9가-힣\s,]+?)(?:으)?로/g;
        let match;
        while ((match = amountRegex.exec(text)) !== null) {
            let oldAmt = parseKoreanNumberString(match[1]);
            let newAmt = parseKoreanNumberString(match[2]);
            if (!isNaN(oldAmt) && !isNaN(newAmt)) {
                let itemList = items.filter(i => Math.abs(i.amount) === Math.abs(oldAmt));
                if (itemList.length > 0) {
                    let target = itemList[itemList.length - 1];
                    target.amount = target.amount < 0 ? -newAmt : newAmt;
                    corrected = true;
                }
            }
        }

        // 2. 수량 수정 (예: 3만원은 2개가 아니라 3개)
        const qtyRegex = /([0-9가-힣\s,]+?)[은는]\s+.*?(?:아니라|대신|가\s*아니고)?\s*([0-9가-힣\s]+개)/g;
        while ((match = qtyRegex.exec(text)) !== null) {
            let amt = parseKoreanNumberString(match[1]);
            let newQtyStr = match[2];
            let newQty = parseQuantity(newQtyStr);
            if (!isNaN(amt) && !isNaN(newQty)) {
                let itemList = items.filter(i => Math.abs(i.amount) === Math.abs(amt));
                if (itemList.length > 0) {
                    itemList[itemList.length - 1].quantity = newQty;
                    corrected = true;
                }
            }
        }

        if (corrected) renderItems();
    }

    function parseKoreanNumberString(str) {
        if (!str) return NaN;
        str = str.replace(/원/g, '').replace(/,/g, '').trim();

        if (/^\d+$/.test(str.replace(/\s+/g, ''))) {
            let parts = str.split(/\s+/);
            if (parts.every(p => /^\d+$/.test(p))) {
                return parts.reduce((sum, p) => sum + parseInt(p, 10), 0);
            }
        }

        const units = { '십': 10, '백': 100, '천': 1000 };
        const largeUnits = { '만': 10000, '억': 100000000, '조': 1000000000000 };
        const korNums = { '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '칠': 7, '팔': 8, '구': 9, '영': 0, '공': 0, '유': 6, '융': 6, '국': 9 };

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
        const korMap = {
            '한': 1, '하나': 1, '일': 1,
            '두': 2, '둘': 2, '이': 2,
            '세': 3, '셋': 3, '삼': 3,
            '네': 4, '넷': 4, '사': 4,
            '다섯': 5, '오': 5,
            '여섯': 6, '육': 6,
            '일곱': 7, '칠': 7,
            '여덟': 8, '팔': 8,
            '아홉': 9, '구': 9,
            '열': 10, '십': 10
        };
        return korMap[str] || 1;
    }

    // --- UI 렌더링 로직 ---
    function calculateRowBaseTotal(item) {
        return item.amount * item.quantity;
    }

    function calculateRowDiscount(item) {
        if (!item.discountRate) return 0;
        return Math.floor(calculateRowBaseTotal(item) * (item.discountRate / 100));
    }

    function calculateRowTotal(item) {
        return calculateRowBaseTotal(item) - calculateRowDiscount(item);
    }

    function calculateTotalDiscount() {
        let itemsDiscount = items.reduce((acc, item) => acc + calculateRowDiscount(item), 0);
        let extra = sessionsData[currentTab].extraDiscount || 0;
        return itemsDiscount + extra;
    }

    function calculateTotal() {
        let total = items.reduce((acc, item) => acc + calculateRowTotal(item), 0);
        let extra = sessionsData[currentTab].extraDiscount || 0;
        return total - extra;
    }

    function renderItems() {
        const tbody = document.getElementById('receipt-body');
        tbody.innerHTML = '';

        items.forEach((item, index) => {
            const discountAmt = calculateRowDiscount(item);
            const hasDiscount = discountAmt > 0;
            const rowStyle = hasDiscount ? 'background: #fff5f5;' : '';
            let discountHtml = '';
            if (hasDiscount) {
                discountHtml = `<div style="color: #ef4444; font-size: 12px; margin-top: 3px; font-weight: 600;">-${discountAmt.toLocaleString()}원 (${item.discountRate}%)</div>`;
            }

            const tr = document.createElement('tr');
            tr.style.cssText = rowStyle;
            tr.innerHTML = `
                <td style="text-align: center; font-weight: bold; color: var(--text-mut); font-size: 11px; padding: 10px 2px; width: 24px;">${index + 1}</td>
                <td><input type="text" inputmode="numeric" pattern="[0-9]*" class="row-amount num-input" data-id="${item.id}" value="${item.amount.toLocaleString()}"></td>
                <td style="text-align: center;">
                    <div class="qty-control">
                        <button class="qty-btn qty-minus" data-id="${item.id}">-</button>
                        <input type="number" class="row-qty qty-input" data-id="${item.id}" value="${item.quantity}" min="0" max="100">
                        <button class="qty-btn qty-plus" data-id="${item.id}">+</button>
                    </div>
                </td>
                <td class="row-total" style="vertical-align: middle;">
                    <div>${calculateRowTotal(item).toLocaleString()}</div>
                    ${discountHtml}
                </td>
                <td><input type="text" class="row-memo" data-id="${item.id}" value="${item.memo}" placeholder="메모" title="${item.memo}"></td>
                <td><button class="del-row-btn" data-id="${item.id}"><i class="fa-solid fa-trash"></i></button></td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll('.row-amount').forEach(el => {
            el.addEventListener('focus', () => {
                activeInput = el;
                isNewKeypadEntry = true;
                originalValue = parseInt(el.value.replace(/,/g, '')) || 0;
            });
            el.addEventListener('input', (e) => {
                let val = parseInt(e.target.value.replace(/,/g, '')) || 0;
                e.target.value = val.toLocaleString();
                updateItem(e.target.dataset.id, 'amount', val);
            });
        });

        document.querySelectorAll('.row-qty').forEach(el => {
            el.addEventListener('focus', () => {
                activeInput = el;
                isNewKeypadEntry = true;
                originalValue = parseInt(el.value) || 0;
            });
            el.addEventListener('input', (e) => {
                let val = parseInt(e.target.value) || 0;
                if (val < 0) val = 0;
                if (val > 100) val = 100;
                e.target.value = val;
                updateItem(e.target.dataset.id, 'quantity', val);
            });
        });

        document.querySelectorAll('.qty-minus').forEach(el => {
            el.addEventListener('click', (e) => {
                let id = e.target.dataset.id;
                let item = items.find(i => i.id == id);
                if (item && item.quantity > 0) {
                    item.quantity--;
                    updateItemAndRender(id, 'quantity', item.quantity);
                }
            });
            el.addEventListener('mousedown', (e) => e.preventDefault());
        });

        document.querySelectorAll('.qty-plus').forEach(el => {
            el.addEventListener('click', (e) => {
                let id = e.target.dataset.id;
                let item = items.find(i => i.id == id);
                if (item && item.quantity < 100) {
                    item.quantity++;
                    updateItemAndRender(id, 'quantity', item.quantity);
                }
            });
            el.addEventListener('mousedown', (e) => e.preventDefault());
        });

        document.querySelectorAll('.row-memo').forEach(el => {
            el.addEventListener('focus', () => { activeInput = el; });
            el.addEventListener('change', (e) => {
                let item = items.find(i => i.id == e.target.dataset.id);
                if (item) item.memo = e.target.value;
            });
        });

        document.querySelectorAll('.del-row-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                let btn = e.target.closest('button');
                items = items.filter(i => i.id != btn.dataset.id);
                sessionsData[currentTab].items = items;
                renderItems();
            });
        });

        const extraInput = document.getElementById('extra-discount');
        if (extraInput && document.activeElement !== extraInput) {
            extraInput.value = (sessionsData[currentTab].extraDiscount || 0).toLocaleString();
        }

        document.getElementById('total-sum').textContent = calculateTotal().toLocaleString() + '원';

        // 총 할인율 계산 및 표시
        const totalDiscountEl = document.getElementById('total-discount');
        const totalDiscountAmt = calculateTotalDiscount();
        const totalBeforeDiscount = items.reduce((acc, item) => acc + calculateRowBaseTotal(item), 0)
            + (sessionsData[currentTab].extraDiscount || 0);
        if (totalDiscountAmt > 0 && totalBeforeDiscount > 0) {
            const discountPercent = Math.round(totalDiscountAmt / totalBeforeDiscount * 100);
            totalDiscountEl.textContent = `할인: -${totalDiscountAmt.toLocaleString()}원 (${discountPercent}% 할인)`;
        } else {
            totalDiscountEl.textContent = '';
        }
    }

    function updateItem(id, field, value) {
        let item = items.find(i => i.id == id);
        if (item) {
            item[field] = value;
            updateRowTotal(item);
        }
    }

    function updateItemAndRender(id, field, value) {
        let item = items.find(i => i.id == id);
        if (item) {
            item[field] = value;
            renderItems();
        }
    }

    function updateRowTotal(item) {
        const input = document.querySelector(`input[data-id="${item.id}"]`);
        if (input) {
            const tr = input.closest('tr');
            let discountHtml = '';
            let discountAmt = calculateRowDiscount(item);
            const hasDiscount = discountAmt > 0;
            if (hasDiscount) {
                discountHtml = `<div style="color: #ef4444; font-size: 12px; margin-top: 3px; font-weight: 600;">-${discountAmt.toLocaleString()}원 (${item.discountRate}%)</div>`;
                tr.style.background = '#fff5f5';
            } else {
                tr.style.background = '';
            }
            tr.querySelector('.row-total').innerHTML = `
                <div>${calculateRowTotal(item).toLocaleString()}</div>
                ${discountHtml}
            `;
            document.getElementById('total-sum').textContent = calculateTotal().toLocaleString() + '원';

            const totalDiscountAmt = calculateTotalDiscount();
            const totalDiscountEl = document.getElementById('total-discount');
            const totalBeforeDiscount = items.reduce((acc, it) => acc + calculateRowBaseTotal(it), 0)
                + (sessionsData[currentTab].extraDiscount || 0);
            if (totalDiscountAmt > 0 && totalBeforeDiscount > 0) {
                const discountPercent = Math.round(totalDiscountAmt / totalBeforeDiscount * 100);
                totalDiscountEl.textContent = `할인: -${totalDiscountAmt.toLocaleString()}원 (${discountPercent}% 할인)`;
            } else {
                totalDiscountEl.textContent = '';
            }
        }
    }



    // --- 기록 (History) 기능 ---
    document.getElementById('reset-btn').addEventListener('click', () => {
        if (confirm('현재 입력된 모든 내용을 초기화하시겠습니까?')) {
            items = [];
            sessionsData[currentTab].items = items;
            sessionsData[currentTab].memo = '';
            sessionsData[currentTab].extraDiscount = 0;
            document.getElementById('session-memo').value = '';
            renderItems();
        }
    });

    document.getElementById('save-btn').addEventListener('click', () => {
        if (items.length === 0) return;

        const now = new Date();
        const session = {
            id: now.getTime(),
            date: now.toLocaleDateString(),
            time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            time24: now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0'),
            items: JSON.parse(JSON.stringify(items)),
            total: calculateTotal(),
            totalDiscount: calculateTotalDiscount(),
            memo: document.getElementById('session-memo').value,
            extraDiscount: sessionsData[currentTab].extraDiscount || 0
        };

        let history = JSON.parse(localStorage.getItem('calcHistory') || '[]');
        history.push(session);

        // 최근 30개만 유지 (오래된 순으로 삭제)
        if (history.length > 30) {
            history = history.slice(history.length - 30);
        }

        localStorage.setItem('calcHistory', JSON.stringify(history));

        items = [];
        sessionsData[currentTab].items = items;
        sessionsData[currentTab].memo = '';
        sessionsData[currentTab].extraDiscount = 0;
        document.getElementById('session-memo').value = '';
        renderItems();
        alert('계산이 완료되어 기록에 저장되었습니다.');

        if (isListening && recognition) {
            try { recognition.stop(); } catch (e) { }
        }
    });

    function getTime24(s) {
        if (s.time24) return s.time24;
        if (s.time) {
            let mMatch = s.time.match(/오전|오후/);
            let tMatch = s.time.match(/(\d+):(\d+)/);
            if (tMatch) {
                let h = parseInt(tMatch[1]);
                let m = tMatch[2];
                if (mMatch && mMatch[0] === '오후' && h < 12) h += 12;
                if (mMatch && mMatch[0] === '오전' && h === 12) h = 0;
                return h.toString().padStart(2, '0') + ':' + m;
            }
        }
        return "00:00";
    }

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

    document.getElementById('hist-search-btn').addEventListener('click', () => {
        renderHistory();
    });

    function renderHistory() {
        const list = document.getElementById('history-list');
        let history = JSON.parse(localStorage.getItem('calcHistory') || '[]');

        const dtStart = document.getElementById('hist-datetime-start').value;
        const dtEnd = document.getElementById('hist-datetime-end').value;

        if (dtStart && dtEnd) {
            const startLimit = new Date(dtStart).getTime();
            const endLimit = new Date(dtEnd).getTime();

            history = history.filter(s => {
                const sessionTime = s.id; // s.id는 getTime() 결과
                return sessionTime >= startLimit && sessionTime <= endLimit;
            });
        }

        if (history.length === 0) {
            list.innerHTML = '<p class="empty-msg">해당 조건에 맞는 과거 계산 기록이 없습니다.</p>';
            return;
        }

        history.sort((a, b) => b.id - a.id);

        let groups = {};
        history.forEach(session => {
            let d = session.date || new Date(session.id).toLocaleDateString();
            if (!groups[d]) groups[d] = [];
            groups[d].push(session);
        });

        let html = '';
        for (let date in groups) {
            html += `
            <div class="history-date-group">
                <div class="history-date-header">
                    <span>${date}</span>
                    <button class="history-date-delete-btn" onclick="deleteHistoryByDate('${date}')">이 날짜 일괄 삭제</button>
                </div>
            `;
            groups[date].forEach(session => {
                let totalDiscountHtml = '';
                if (session.totalDiscount && session.totalDiscount > 0) {
                    totalDiscountHtml = `<span style="color: #3b82f6; font-size: 14px; margin-right: 10px;">할인: -${session.totalDiscount.toLocaleString()}원</span>`;
                }

                html += `
                <div class="history-card">
                    <div class="hist-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none';" style="cursor: pointer; display: flex; justify-content: space-between; align-items: flex-start;">
                        <div style="display: flex; flex-direction: column; flex: 1; padding-right: 15px;">
                            <span><i class="fa-regular fa-clock"></i> ${session.time || getTime24(session)}</span>
                            ${session.memo ? `<span style="font-size: 13px; color: var(--text-mut); margin-top: 6px; font-weight: 500; line-height: 1.4;"><i class="fa-solid fa-note-sticky"></i> ${session.memo}</span>` : ''}
                        </div>
                        <div style="white-space: nowrap; text-align: right;">
                            ${totalDiscountHtml}
                            <span class="hist-total">${session.total.toLocaleString()}원 <i class="fa-solid fa-chevron-down" style="font-size:0.8em; margin-left:5px;"></i></span>
                        </div>
                    </div>
                    <div class="hist-details" style="display: none;">
                        <div class="hist-items">
                            ${session.items.map((item, idx) => {
                    let qtyHtml = item.quantity > 1 ? ` × <span style="color: red; font-weight: bold;">${item.quantity}</span>` : '';
                    let baseTotal = item.amount * item.quantity;
                    let itemDiscount = item.discountRate ? Math.floor(baseTotal * (item.discountRate / 100)) : 0;
                    let itemTotal = baseTotal - itemDiscount;
                    let discountHtml = itemDiscount > 0 ? `<div style="color: #3b82f6; font-size: 12px; margin-top: 3px;">-${itemDiscount.toLocaleString()}원 (${item.discountRate}%)</div>` : '';

                    return `
                                <div class="hist-item-row" style="display: flex; justify-content: space-between; align-items: flex-start;">
                                    <span style="padding-right: 10px;">${idx + 1}. ${item.amount.toLocaleString()}${qtyHtml}</span>
                                    <div style="text-align: right;">
                                        ${item.memo ? `<span class="hist-item-memo">(${item.memo})</span> ` : ''}
                                        <strong>${itemTotal.toLocaleString()}</strong>
                                        ${discountHtml}
                                    </div>
                                </div>
                                `;
                }).join('')}
                            ${session.extraDiscount > 0 ? `<div style="margin-top: 10px; text-align: right; color: #3b82f6; font-size: 14px; font-weight: 600;">추가 할인: -${session.extraDiscount.toLocaleString()}원</div>` : ''}
                        </div>
                        <div class="hist-actions">
                            <button class="hist-load-btn" onclick="loadSession(${session.id})">불러오기</button>
                            <button class="hist-del-btn" onclick="deleteHistory(${session.id})">삭제</button>
                        </div>
                    </div>
                </div>
                `;
            });
            html += `</div>`;
        }
        list.innerHTML = html;
    }

    window.deleteHistoryByDate = function (dateStr) {
        if (confirm(`${dateStr} 의 모든 기록을 정말 삭제하시겠습니까?`)) {
            let history = JSON.parse(localStorage.getItem('calcHistory') || '[]');
            history = history.filter(s => {
                let d = s.date || new Date(s.id).toLocaleDateString();
                return d !== dateStr;
            });
            localStorage.setItem('calcHistory', JSON.stringify(history));
            renderHistory();
        }
    };

    window.loadSession = function (id) {
        let history = JSON.parse(localStorage.getItem('calcHistory') || '[]');
        let session = history.find(s => s.id === id);
        if (session) {
            items = JSON.parse(JSON.stringify(session.items));
            sessionsData[currentTab].items = items;
            sessionsData[currentTab].memo = session.memo || '';
            sessionsData[currentTab].extraDiscount = session.extraDiscount || 0;
            document.getElementById('session-memo').value = sessionsData[currentTab].memo;
            renderItems();
            document.getElementById('history-modal').classList.remove('active');
        }
    };

    window.deleteHistory = function (id) {
        if (confirm('이 기록을 삭제하시겠습니까?')) {
            let history = JSON.parse(localStorage.getItem('calcHistory') || '[]');
            history = history.filter(s => s.id !== id);
            localStorage.setItem('calcHistory', JSON.stringify(history));
            renderHistory();
        }
    };

    // Tab switching and session memo logic
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
            else if (currentTab === 1) panel.style.backgroundColor = '#fdf2f8'; // 연분홍
            else if (currentTab === 2) panel.style.backgroundColor = '#f0fdf4'; // 연녹색

            renderItems();
        });
    });



    document.getElementById('extra-discount').addEventListener('input', (e) => {
        let val = parseInt(e.target.value.replace(/,/g, '')) || 0;
        e.target.value = val.toLocaleString();
        sessionsData[currentTab].extraDiscount = val;
        renderItems();
    });
    document.getElementById('extra-discount').addEventListener('focus', (e) => { activeInput = e.target; });

    document.getElementById('session-memo').addEventListener('input', (e) => {
        sessionsData[currentTab].memo = e.target.value;
    });
});
