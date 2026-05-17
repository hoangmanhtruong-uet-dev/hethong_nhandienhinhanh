// ── Chế độ Giơ lên nhận diện (Show & Recognize) ──

const LIVE_INTERVAL_MS = 420;
const LIVE_STABLE_FRAMES = 2;
const LIVE_MIN_SCORE = 0.22;

let showRecognizeActive = false;
let showRecognizeRaf = null;
let showLiveBusy = false;
let lastLiveTick = 0;
let stableInsight = { key: '', count: 0 };
let lastSpokenKey = '';
let facingMode = 'environment';

const liveLabelOverlay = document.getElementById('live-label-overlay');
const liveLabelIcon    = document.getElementById('live-label-icon');
const liveLabelName    = document.getElementById('live-label-name');
const liveLabelConf    = document.getElementById('live-label-conf');
const liveLabelSub     = document.getElementById('live-label-sub');
const optAutoShow      = document.getElementById('opt-auto-show');
const optTtsLive       = document.getElementById('opt-tts-live');
const flipCameraBtn    = document.getElementById('flip-camera-btn');

const ANIMAL_CLASSES = new Set([
    'person','bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe',
    'rabbit','fish'
]);

function getLiveThreshold() {
    const slider = parseInt(confSlider?.value || 40, 10) / 100;
    return Math.min(slider, 0.35);
}

function applyLiveDetectionFilters(detections) {
    const threshold = getLiveThreshold();
    let list = detections.filter(d => d.score >= threshold);
    if (typeof isLabelFilterActive === 'function' && isLabelFilterActive()) {
        list = list.filter(d => activeLabelFilters.has(normalizeClassId(d.class)));
    }
    return list;
}

function getClassEmoji(label, source) {
    const l = (label || '').toLowerCase();
    if (ANIMAL_CLASSES.has(l) || /chó|mèo|chim|ngựa|bò|voi|gấu|thỏ|cá|động vật|hamster|sóc|cáo|vịt|gà|lợn|ếch|rắn|rùa|hổ|sư tử|khỉ|chuột|heo|cừu/.test(l)) {
        if (l.includes('cat') || l.includes('mèo')) return '🐱';
        if (l.includes('dog') || l.includes('chó')) return '🐕';
        if (l.includes('bird') || l.includes('chim')) return '🐦';
        if (l.includes('fish') || l.includes('cá')) return '🐟';
        if (l.includes('horse') || l.includes('ngựa')) return '🐴';
        if (l.includes('cow') || l.includes('bò')) return '🐄';
        if (l.includes('elephant') || l.includes('voi')) return '🐘';
        if (l.includes('bear') || l.includes('gấu')) return '🐻';
        if (l.includes('rabbit') || l.includes('thỏ')) return '🐰';
        return '🐾';
    }
  if (/phone|điện thoại|cell/.test(l)) return '📱';
    if (/laptop|máy tính/.test(l)) return '💻';
    if (/bottle|chai/.test(l)) return '🍾';
    if (/cup|cốc|bowl|bát/.test(l)) return '☕';
    if (/book|sách/.test(l)) return '📚';
    if (/car|ô tô|xe/.test(l)) return '🚗';
    if (/banana|chuối|apple|táo|pizza|food|ăn/.test(l)) return '🍽️';
    if (/chair|ghế|table|bàn/.test(l)) return '🪑';
    if (/person|người/.test(l)) return '👤';
    return source === 'classify' ? '🔍' : '📦';
}

function mergeLiveInsight(filteredDetections, predictions) {
    let bestDet = null;
    if (filteredDetections.length) {
        bestDet = filteredDetections
            .map(d => {
                const [, , w, h] = d.bbox;
                return { ...d, weight: w * h * d.score };
            })
            .sort((a, b) => b.weight - a.weight)[0];
    }

    const topPred = predictions?.[0];
    const predName = topPred?.className?.split(',')[0]?.trim() || '';
    const predScore = topPred?.probability || 0;

    if (bestDet && bestDet.score >= LIVE_MIN_SCORE) {
        const detScore = bestDet.score;
        if (predScore > detScore + 0.12 && predScore >= LIVE_MIN_SCORE) {
            return {
                label: predName,
                vi: translateLabel(predName),
                score: predScore,
                source: 'classify',
                en: predName
            };
        }
        return {
            label: bestDet.class,
            vi: translateLabel(bestDet.class),
            score: detScore,
            source: 'detect',
            en: bestDet.class
        };
    }

    if (predScore >= LIVE_MIN_SCORE) {
        return {
            label: predName,
            vi: translateLabel(predName),
            score: predScore,
            source: 'classify',
            en: predName
        };
    }

    return null;
}

function updateLiveOverlay(insight) {
    if (!liveLabelOverlay) return;

    if (!insight) {
        liveLabelOverlay.hidden = true;
        stableInsight = { key: '', count: 0 };
        return;
    }

    const key = `${insight.vi}|${insight.score.toFixed(2)}`;
    if (key === stableInsight.key) stableInsight.count++;
    else stableInsight = { key, count: 1 };

    if (stableInsight.count < LIVE_STABLE_FRAMES && insight.score < 0.75) return;

    liveLabelOverlay.hidden = false;
    if (liveLabelIcon) liveLabelIcon.textContent = getClassEmoji(insight.en || insight.label, insight.source);
    if (liveLabelName) liveLabelName.textContent = insight.vi;
    if (liveLabelConf) liveLabelConf.textContent = `${(insight.score * 100).toFixed(0)}%`;
    if (liveLabelSub) {
        liveLabelSub.textContent = insight.source === 'detect'
            ? 'Phát hiện vật thể (COCO-SSD)'
            : 'Phân loại chi tiết (MobileNet)';
    }

    if (optTtsLive?.checked && key !== lastSpokenKey && insight.score >= 0.5) {
        lastSpokenKey = key;
        speakLiveLabel(insight);
    }
}

function speakLiveLabel(insight) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(
        `Đây là ${insight.vi}, độ tin cậy ${(insight.score * 100).toFixed(0)} phần trăm`
    );
    u.lang = 'vi-VN';
    u.rate = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const vi = voices.find(v => v.lang.startsWith('vi'));
    if (vi) u.voice = vi;
    window.speechSynthesis.speak(u);
}

function renderLiveResults(insight, filtered, predictions) {
    if (!resultsSection) return;
    resultsSection.hidden = false;

    if (insight) {
        aiDescText.textContent = `Đang nhìn thấy: ${insight.vi} (${(insight.score * 100).toFixed(0)}%)`;
        statusText.textContent = 'Đang nhận diện trực tiếp…';
        document.querySelector('#result-dot')?.classList.add('success');
    }

    detTags.innerHTML = '';
    if (filtered.length) {
        renderDetectionTags(filtered);
        detectionsSection.hidden = false;
    } else {
        detectionsSection.hidden = true;
    }

    if (typeof updateResultsUI === 'function') updateResultsUI(predictions, filtered);
    else if (typeof renderResultTable === 'function') renderResultTable(filtered);

    if (predictions?.length && classifyLabel) {
        classifyLabel.hidden = false;
        predictionList.innerHTML = '';
        renderPredictions(predictions.slice(0, 3));
    }
}

async function showRecognizeLoop() {
    if (!showRecognizeActive || !webcamRunning) return;
    showRecognizeRaf = requestAnimationFrame(showRecognizeLoop);

    const now = performance.now();
    if (now - lastLiveTick < LIVE_INTERVAL_MS || showLiveBusy) return;
    if (!classifierModel || !detectorModel || webcamVideo.readyState < 2) return;

    lastLiveTick = now;
    showLiveBusy = true;

    try {
        const doClassify = document.getElementById('opt-classify')?.checked !== false;
        const doDetect = document.getElementById('opt-detect')?.checked !== false;
        const doBBoxes = document.getElementById('opt-bboxes')?.checked !== false;

        const [detections, predictions] = await Promise.all([
            doDetect ? detectorModel.detect(webcamVideo) : Promise.resolve([]),
            doClassify ? classifierModel.classify(webcamVideo) : Promise.resolve([])
        ]);

        const filtered = applyLiveDetectionFilters(detections);
        const insight = mergeLiveInsight(filtered, predictions);

        updateLiveOverlay(insight);
        renderLiveResults(insight, filtered, predictions);

        if (doBBoxes && filtered.length) {
            drawBoundingBoxes(webcamVideo, webcamCanvas, filtered);
        } else if (webcamCanvas) {
            const ctx = webcamCanvas.getContext('2d');
            ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
        }
    } catch (e) {
        console.warn('Show recognize:', e);
    } finally {
        showLiveBusy = false;
    }
}

function startShowRecognize() {
    if (!webcamRunning || !classifierModel || !detectorModel) return;
    showRecognizeActive = true;
    lastLiveTick = 0;
    stableInsight = { key: '', count: 0 };
    lastSpokenKey = '';

    if (liveBadge) liveBadge.hidden = false;
    if (optAutoShow) optAutoShow.checked = true;
    resultsSection.hidden = false;
    statusText.textContent = 'Giơ vật thể vào khung hình…';

    showRecognizeLoop();
}

function stopShowRecognize() {
    showRecognizeActive = false;
    if (showRecognizeRaf) cancelAnimationFrame(showRecognizeRaf);
    showRecognizeRaf = null;
    if (liveLabelOverlay) liveLabelOverlay.hidden = true;
    if (liveBadge) liveBadge.hidden = true;
    stableInsight = { key: '', count: 0 };
}

async function startWebcamWithMode() {
    if (webcamStream) {
        webcamStream.getTracks().forEach(t => t.stop());
    }
    webcamStream = await navigator.mediaDevices.getUserMedia({
        video: {
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 }
        },
        audio: false
    });
    webcamVideo.srcObject = webcamStream;
    webcamVideo.hidden = false;
    webcamPlaceholder.hidden = true;
    startWebcamBtn.hidden = true;
    stopWebcamBtn.hidden = false;
    webcamCaptureBtn.disabled = false;
    if (flipCameraBtn) flipCameraBtn.hidden = false;
    webcamRunning = true;

    await new Promise((resolve) => {
        if (webcamVideo.readyState >= 2) resolve();
        else webcamVideo.onloadeddata = resolve;
    });

    if (optAutoShow?.checked !== false) startShowRecognize();
}

function initShowRecognize() {
    optAutoShow?.addEventListener('change', () => {
        if (optAutoShow.checked && webcamRunning) startShowRecognize();
        else stopShowRecognize();
    });

    flipCameraBtn?.addEventListener('click', async () => {
        facingMode = facingMode === 'environment' ? 'user' : 'environment';
        if (!webcamRunning) return;
        const wasShowing = showRecognizeActive;
        stopShowRecognize();
        try {
            await startWebcamWithMode();
        } catch (e) {
            alert('Không đổi được camera: ' + e.message);
        }
        if (wasShowing) startShowRecognize();
    });
}

initShowRecognize();

window.startShowRecognize = startShowRecognize;
window.stopShowRecognize = stopShowRecognize;
window.startWebcamWithMode = startWebcamWithMode;
window.showRecognizeActive = false;
