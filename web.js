(() => {
  "use strict";

  const MAX_PREDICTION_RETRY_MS = 5000;
  const MEDIAPIPE_VERSION = "0.10.14";
  const MEDIAPIPE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
  const HAND_LANDMARKER_MODEL =
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
  const fingerNames = ["Ngón cái", "Ngón trỏ", "Ngón giữa", "Ngón áp út", "Ngón út"];
  const fingerJoints = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
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
  let handLandmarker = null;
  let visionModulePromise = null;
  let predictionBusy = false;
  let predictionFailures = 0;
  let reportedPredictionFailure = false;
  let predictionHistory = [];
  let toastTimer = null;

  function loadVisionModule() {
    if (!visionModulePromise) {
      visionModulePromise = import(`${MEDIAPIPE_CDN}/vision_bundle.mjs`).catch((error) => {
        visionModulePromise = null;
        throw error;
      });
    }
    return visionModulePromise;
  }

  async function getHandLandmarker() {
    if (handLandmarker) return handLandmarker;
    const { FilesetResolver, HandLandmarker } = await loadVisionModule();
    const vision = await FilesetResolver.forVisionTasks(`${MEDIAPIPE_CDN}/wasm`);
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: HAND_LANDMARKER_MODEL,
        delegate: "CPU"
      },
      runningMode: "VIDEO",
      numHands: 2
    });
    return handLandmarker;
  }

  function distance(first, second) {
    return Math.hypot(
      first[0] - second[0],
      first[1] - second[1],
      first[2] - second[2]
    );
  }

  function jointAngle(first, joint, last) {
    const firstVector = first.map((value, index) => value - joint[index]);
    const lastVector = last.map((value, index) => value - joint[index]);
    const lengths = Math.hypot(...firstVector) * Math.hypot(...lastVector);
    if (lengths < 1e-6) return 0;
    const cosine = firstVector.reduce(
      (sum, value, index) => sum + value * lastVector[index],
      0
    ) / lengths;
    return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
  }

  function fingerStatesFromLandmarks(landmarks, width, height) {
    const points = landmarks.map((point) => [
      point.x * width,
      point.y * height,
      (point.z || 0) * width
    ]);
    const palmSize = distance(points[9], points[0]);
    if (palmSize < 1e-6) return [false, false, false, false, false];
    const palmAxis = points[9].map((value, index) => (value - points[0][index]) / palmSize);
    const extendedFingers = fingerJoints.map(([mcp, pip, dip, tip]) => {
      const segmentLengths = distance(points[mcp], points[pip]) +
        distance(points[pip], points[dip]) +
        distance(points[dip], points[tip]);
      const straightness = distance(points[tip], points[mcp]) / Math.max(segmentLengths, 1e-6);
      const palmExtension = points[tip].reduce(
        (sum, value, index) => sum + (value - points[mcp][index]) * palmAxis[index],
        0
      ) / palmSize;
      return straightness >= 0.78 &&
        jointAngle(points[mcp], points[pip], points[dip]) >= 135 &&
        jointAngle(points[pip], points[dip], points[tip]) >= 125 &&
        palmExtension >= 0.42;
    });

    const thumbStraightness = distance(points[4], points[2]) /
      Math.max(distance(points[2], points[3]) + distance(points[3], points[4]), 1e-6);
    const thumbTipToIndex = distance(points[4], points[5]) / palmSize;
    const thumbJointToIndex = distance(points[3], points[5]) / palmSize;
    const thumbOutwardExtension = (distance(points[4], points[0]) - distance(points[3], points[0])) /
      palmSize;
    const thumbExtended = thumbStraightness >= 0.78 &&
      jointAngle(points[2], points[3], points[4]) >= 135 &&
      thumbTipToIndex - thumbJointToIndex > 0.10 &&
      thumbOutwardExtension >= 0.08;
    return [thumbExtended, ...extendedFingers];
  }

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
        return "Safari chỉ cho phép dùng camera trên HTTPS (hoặc localhost). Hãy mở ứng dụng bằng đường dẫn HTTPS.";
      case "NotSupportedError":
        return "Không tải được bộ nhận diện. Hãy kiểm tra kết nối Internet rồi thử lại.";
      case "AbortError":
        return "Camera bị ngắt khi đang khởi động. Hãy kiểm tra kết nối webcam rồi thử lại.";
      default:
        return `Không mở được camera (${error.name || "lỗi không xác định"}). Hãy đóng ứng dụng khác đang dùng webcam rồi thử lại.`;
    }
  }

  async function startCamera() {
    if (mediaStream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("Trình duyệt chưa cho phép camera. Hãy mở ứng dụng qua HTTPS hoặc localhost.");
      return;
    }
    startCameraButton.disabled = true;
    startCameraButton.innerHTML = "<span aria-hidden=\"true\">…</span> Đang bật camera";
    let cameraStarted = false;
    try {
      mediaStream = await requestCameraStream();
      video.srcObject = mediaStream;
      await video.play();
      cameraStarted = true;
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
      setCameraState(true, "Đang tải bộ nhận diện");
      await getHandLandmarker();
      if (!mediaStream) return;
      setCameraState(true, "Đang nhận diện trên thiết bị");
      startPredictionLoop();
    } catch (error) {
      stopCamera();
      setCameraState(false, "Camera đang tắt");
      if (!cameraStarted) {
        showToast(cameraErrorMessage(error), 7000);
      } else {
        console.error("Could not initialize on-device hand recognition:", error);
        showToast(`Không tải được bộ nhận diện. Hãy kiểm tra kết nối Internet rồi thử lại. ${error.message || ""}`, 7000);
      }
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
    if (handLandmarker) {
      handLandmarker.close();
      handLandmarker = null;
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
        const detection = handLandmarker.detectForVideo(video, performance.now());
        const hands = (detection.landmarks || []).map((landmarks) => {
          const fingerStates = fingerStatesFromLandmarks(landmarks, canvas.width, canvas.height);
          return {
            digit: fingerStates.filter(Boolean).length,
            fingers: fingerNames.map((name, index) => ({
              name,
              extended: fingerStates[index]
            })),
            landmarks: landmarks.map(({ x, y }) => ({ x, y }))
          };
        });
        const result = {
          detected: hands.length > 0,
          digit: hands.reduce((total, hand) => total + hand.digit, 0),
          hands
        };
        if (mediaStream) {
          predictionFailures = 0;
          reportedPredictionFailure = false;
          setCameraState(true, "Đang nhận diện trên thiết bị");
          renderPrediction(result);
        }
      } catch (error) {
        if (mediaStream) {
          predictionFailures += 1;
          setCameraState(true, "Đang thử lại nhận diện");
          if (!reportedPredictionFailure) {
            console.error("On-device hand recognition failed:", error);
            showToast(`Nhận diện gặp lỗi tạm thời; đang thử lại. ${error.message || ""}`, 5000);
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
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("Could not register the app service worker:", error);
    });
  }
})();
