(() => {
  "use strict";

  const MAX_PREDICTION_RETRY_MS = 5000;
  const fingerNames = ["Ngón cái", "Ngón trỏ", "Ngón giữa", "Ngón áp út", "Ngón út"];
  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
  ];
  const palette = ["#f2a866", "#83d1ab", "#9cb9ef", "#d5a0df", "#f0a0aa"];
  const video = document.querySelector("#camera-video");
  const canvas = document.querySelector("#landmark-canvas");
  const context = canvas.getContext("2d");
  const stage = document.querySelector("#camera-stage");
  const empty = document.querySelector("#camera-empty");
  const overlay = document.querySelector("#camera-overlay");
  const badge = document.querySelector("#camera-badge");
  const cameraStatus = document.querySelector("#camera-status");
  const numberResult = document.querySelector("#number-result");
  const resultMessage = document.querySelector("#result-message");
  const fingerList = document.querySelector("#finger-list");
  const fingerCount = document.querySelector("#finger-count");
  const cameraCount = document.querySelector("#camera-count");
  const cameraFingerCount = document.querySelector("#camera-finger-count");
  const cameraCountMessage = document.querySelector("#camera-count-message");
  const startCameraButton = document.querySelector("#start-camera");
  const stopCameraButton = document.querySelector("#stop-camera");
  const toastElement = document.querySelector("#toast");

  let mediaStream = null;
  let predictionBusy = false;
  let predictionFailures = 0;
  let reportedPredictionFailure = false;
  let predictionHistory = [];
  let toastTimer = null;

  function showToast(message, duration = 3800) {
    toastElement.textContent = message;
    toastElement.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove("is-visible"), duration);
  }

  function setCameraState(isLive, text) {
    badge.classList.toggle("is-live", isLive);
    cameraStatus.textContent = text;
    startCameraButton.classList.toggle("hidden", isLive);
    stopCameraButton.classList.toggle("hidden", !isLive);
    overlay.classList.toggle("hidden", !isLive);
    stage.classList.toggle("is-active", isLive);
    document.querySelector("#detection-chip").classList.toggle("hidden", !isLive);
    cameraCount.classList.toggle("hidden", !isLive);
    if (isLive && cameraFingerCount.textContent === "–") {
      cameraCountMessage.textContent = "Đưa tay vào khung hình";
    }
  }

  async function requestCameraStream() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      });
    } catch (error) {
      if (!["OverconstrainedError", "ConstraintNotSatisfiedError", "TypeError"].includes(error.name)) {
        throw error;
      }
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
  }

  function cameraErrorMessage(error) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Trình duyệt hoặc Windows đang chặn camera. Hãy cho phép quyền Camera cho trang web và bật quyền camera trong Windows Settings.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "Không tìm thấy camera. Hãy kết nối webcam hoặc kiểm tra camera có đang bị tắt trong Device Manager không.";
      case "NotReadableError":
      case "TrackStartError":
        return "Camera đang được ứng dụng khác sử dụng hoặc driver không mở được thiết bị. Hãy đóng Chrome, Zoom, Teams, OBS và các tab web đang dùng camera rồi thử lại.";
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        return "Camera không hỗ trợ cấu hình video này. Hãy thử chọn webcam khác hoặc kiểm tra driver camera.";
      case "SecurityError":
      case "TypeError":
        return "Trình duyệt không cho phép dùng camera ở địa chỉ này. Hãy mở app bằng http://127.0.0.1:8000 trên chính máy đang chạy app.";
      case "AbortError":
        return "Camera bị ngắt khi đang khởi động. Hãy kiểm tra kết nối webcam rồi thử lại.";
      default:
        return `Không mở được camera (${error.name || "lỗi không xác định"}). Hãy đóng ứng dụng khác đang dùng webcam rồi thử lại.`;
    }
  }

  async function startCamera() {
    if (mediaStream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("Trình duyệt chưa cho phép camera. Hãy mở trang qua http://127.0.0.1:8000.");
      return;
    }
    startCameraButton.disabled = true;
    startCameraButton.innerHTML = "<span aria-hidden=\"true\">…</span> Đang bật camera";
    try {
      mediaStream = await requestCameraStream();
      video.srcObject = mediaStream;
      await video.play();
      for (const track of mediaStream.getVideoTracks()) {
        track.addEventListener("ended", onCameraTrackEnded, { once: true });
      }
      empty.classList.add("hidden");
      stage.classList.add("is-active");
      canvas.width = Math.min(video.videoWidth || 640, 640);
      canvas.height = Math.round(canvas.width * (video.videoHeight || 480) / (video.videoWidth || 640));
      stage.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
      predictionHistory = [];
      predictionFailures = 0;
      reportedPredictionFailure = false;
      setCameraState(true, "Đang nhận diện");
      startPredictionLoop();
    } catch (error) {
      stopCamera();
      setCameraState(false, "Camera đang tắt");
      showToast(cameraErrorMessage(error), 7000);
    } finally {
      startCameraButton.disabled = false;
      startCameraButton.innerHTML = "<span aria-hidden=\"true\">◎</span> Bật camera";
    }
  }

  function stopCamera() {
    predictionBusy = false;
    predictionFailures = 0;
    reportedPredictionFailure = false;
    predictionHistory = [];
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) track.stop();
      mediaStream = null;
    }
    video.srcObject = null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    empty.classList.remove("hidden");
    stage.classList.remove("is-active");
    stage.style.aspectRatio = "";
    setCameraState(false, "Camera đang tắt");
    clearPrediction();
  }

  function onCameraTrackEnded() {
    if (!mediaStream) return;
    stopCamera();
    cameraStatus.textContent = "Camera đã bị ngắt";
    showToast("Camera đã bị ngắt. Bấm Bật camera để kết nối lại.");
  }

  async function startPredictionLoop() {
    if (!mediaStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      if (mediaStream) setTimeout(startPredictionLoop, 150);
      return;
    }
    if (!predictionBusy) {
      predictionBusy = true;
      try {
        const snapshot = document.createElement("canvas");
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        const snapshotContext = snapshot.getContext("2d", { alpha: false });
        snapshotContext.drawImage(video, 0, 0, snapshot.width, snapshot.height);
        const response = await fetch("/api/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: snapshot.toDataURL("image/jpeg", 0.82) })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Không phân tích được khung hình camera.");
        if (mediaStream) {
          predictionFailures = 0;
          reportedPredictionFailure = false;
          setCameraState(true, "Đang nhận diện");
          renderPrediction(result);
        }
      } catch (error) {
        if (mediaStream) {
          predictionFailures += 1;
          setCameraState(true, "Đang kết nối lại bộ nhận diện");
          if (!reportedPredictionFailure) {
            showToast(`Mất kết nối tạm thời. Camera vẫn bật; đang thử kết nối lại. ${error.message || ""}`, 5000);
            reportedPredictionFailure = true;
          }
        }
      } finally {
        predictionBusy = false;
        if (mediaStream) {
          const retryDelay = Math.min(
            MAX_PREDICTION_RETRY_MS,
            180 * (2 ** Math.min(predictionFailures, 5))
          );
          setTimeout(startPredictionLoop, retryDelay);
        }
      }
    }
  }

  function renderPrediction(result) {
    if (!result.detected) {
      predictionHistory = [];
      drawLandmarks([]);
      numberResult.textContent = "–";
      resultMessage.textContent = "Đưa một hoặc hai bàn tay vào khung hình";
      fingerCount.textContent = "0 / 10";
      cameraFingerCount.textContent = "–";
      cameraCountMessage.textContent = "Chưa phát hiện bàn tay";
      renderHands([]);
      document.querySelector("#hand-hint").classList.remove("hidden");
      return;
    }
    document.querySelector("#hand-hint").classList.add("hidden");
    const hands = Array.isArray(result.hands) && result.hands.length
      ? result.hands
      : [{ digit: result.digit, fingers: result.fingers, landmarks: result.landmarks }];
    drawLandmarks(hands.map((hand) => hand.landmarks));
    const rawDigit = Number(result.digit);
    predictionHistory.push(rawDigit);
    if (predictionHistory.length > 7) predictionHistory.shift();
    const counts = new Map();
    predictionHistory.forEach((digit) => counts.set(digit, (counts.get(digit) || 0) + 1));
    const digit = [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0];
    const stableFrames = counts.get(digit);
    numberResult.textContent = String(digit);
    cameraFingerCount.textContent = String(digit);
    cameraCountMessage.textContent = `ngón tay · ${hands.length} ${hands.length === 1 ? "bàn tay" : "bàn tay"}`;
    resultMessage.textContent = stableFrames >= 4
      ? `Đã nhận diện ${hands.length} ${hands.length === 1 ? "bàn tay" : "bàn tay"} · tổng ${digit} ngón`
      : "Đang nhận diện bàn tay…";
    fingerCount.textContent = `${digit} / 10`;
    renderHands(hands);
  }

  function renderHands(hands) {
    fingerList.replaceChildren();
    if (!hands.length) {
      const emptyState = document.createElement("p");
      emptyState.className = "empty-hands";
      emptyState.textContent = "Chưa phát hiện bàn tay";
      fingerList.append(emptyState);
      return;
    }
    hands.forEach((hand, handIndex) => {
      const group = document.createElement("section");
      group.className = "hand-group";
      const heading = document.createElement("div");
      heading.className = "hand-group-heading";
      const label = document.createElement("span");
      label.textContent = `Bàn tay ${handIndex + 1}`;
      const states = Array.isArray(hand.fingers) ? hand.fingers : [];
      const handDigit = Number.isInteger(hand.digit)
        ? hand.digit
        : states.filter((finger) => finger.extended).length;
      const count = document.createElement("strong");
      count.textContent = `${handDigit} / 5 ngón`;
      heading.append(label, count);
      group.append(heading);
      states.forEach((finger, fingerIndex) => {
        const row = document.createElement("div");
        row.className = `finger-row${finger.extended ? " is-raised" : ""}`;
        const icon = document.createElement("span");
        icon.className = "finger-icon";
        icon.textContent = finger.extended ? "↑" : "·";
        const name = document.createElement("span");
        name.textContent = finger.name || fingerNames[fingerIndex];
        const state = document.createElement("span");
        state.className = "finger-state";
        state.textContent = finger.extended ? "Đang giơ" : "Đang gập";
        row.append(icon, name, state);
        group.append(row);
      });
      fingerList.append(group);
    });
  }

  function clearPrediction() {
    predictionHistory = [];
    numberResult.textContent = "–";
    resultMessage.textContent = "Bật camera để bắt đầu nhận diện.";
    fingerCount.textContent = "0 / 10";
    cameraFingerCount.textContent = "–";
    cameraCountMessage.textContent = "Đưa tay vào khung hình";
    renderHands([]);
  }

  function drawLandmarks(hands) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!Array.isArray(hands) || !hands.length) return;
    context.lineWidth = Math.max(2, canvas.width / 260);
    context.lineCap = "round";
    hands.forEach((landmarks, handIndex) => {
      if (!Array.isArray(landmarks) || landmarks.length !== 21) return;
      for (const [start, end] of connections) {
        const first = landmarks[start];
        const second = landmarks[end];
        context.strokeStyle = handIndex === 0 ? "#e2c777df" : "#8ed8c7e8";
        context.beginPath();
        context.moveTo((1 - first.x) * canvas.width, first.y * canvas.height);
        context.lineTo((1 - second.x) * canvas.width, second.y * canvas.height);
        context.stroke();
      }
      landmarks.forEach((point, index) => {
        const color = handIndex === 1
          ? "#86d3c2"
          : index >= 17 ? palette[4] : index >= 13 ? palette[3] : index >= 9 ? palette[2] : index >= 5 ? palette[1] : palette[0];
        context.beginPath();
        context.arc((1 - point.x) * canvas.width, point.y * canvas.height, Math.max(3, canvas.width / 95), 0, 2 * Math.PI);
        context.fillStyle = "#20372d";
        context.fill();
        context.lineWidth = Math.max(1.5, canvas.width / 260);
        context.strokeStyle = color;
        context.stroke();
      });
    });
  }

  document.querySelector("#start-camera").addEventListener("click", startCamera);
  stopCameraButton.addEventListener("click", stopCamera);
  window.addEventListener("pagehide", stopCamera);
})();
