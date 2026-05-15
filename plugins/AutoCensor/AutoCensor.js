(function () {
  const PLUGIN_ID = "AutoCensor";
  const baseURL = document.querySelector("base")?.getAttribute("href") ?? "/";
  // Stash serves assets via /plugin/<id>/assets/<path> when assets mapping is defined
  const PLUGIN_URL = `${window.location.origin}${baseURL}plugin/${PLUGIN_ID}/assets/`;

  const DEFAULT_CONFIG = {
    enabled: true,
    threshold: 50,
    modelUrl: `${PLUGIN_URL}nudenet.onnx`,
    censorLabels: "exposed_breast, exposed_vagina, exposed_anus, exposed penis",
  };

  let config = { ...DEFAULT_CONFIG };
  let session = null;
  let labelsToCensor = [];

  const LABELS = [
    "exposed_anus",
    "exposed_armpits",
    "belly",
    "exposed_belly",
    "buttocks",
    "exposed_buttocks",
    "female_face",
    "male_face",
    "feet",
    "exposed_feet",
    "breast",
    "exposed_breast",
    "vagina",
    "exposed_vagina",
    "male_breast",
    "exposed_penis",
  ];

  async function init() {
    const fetchedConfig = await window.csLib.getConfiguration(PLUGIN_ID);
    config = { ...DEFAULT_CONFIG, ...fetchedConfig };

    // Ensure modelUrl is local if not set or empty
    if (!config.modelUrl) config.modelUrl = DEFAULT_CONFIG.modelUrl;

    if (!config.enabled) {
      console.log("[AutoCensor] Disabled via configuration");
      return;
    }

    labelsToCensor = (config.censorLabels || DEFAULT_CONFIG.censorLabels)
      .split(",")
      .map((s) => s.trim().toLowerCase());

    console.log("[AutoCensor] Initializing...");

    try {
      // Configure WASM paths to point to the local plugin directory
      // This is crucial for bypassing CSP connect-src issues with external CDNs
      ort.env.wasm.wasmPaths = PLUGIN_URL;

      console.log("[AutoCensor] Loading model from:", config.modelUrl);

      // Initialize ONNX Session
      session = await ort.InferenceSession.create(config.modelUrl, {
        executionProviders: ["wasm"],
      });
      console.log("[AutoCensor] ONNX Model loaded successfully");
    } catch (e) {
      console.error("[AutoCensor] Failed to load model:", e);
      return;
    }

    // Observe the document for new images
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === "IMG") {
              processImage(node);
            } else {
              node.querySelectorAll("img").forEach(processImage);
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    document.querySelectorAll("img").forEach(processImage);
  }

  function processImage(img) {
    if (img.dataset.autocensorProcessed || img.src.startsWith("data:")) return;
    if (img.width < 50 || img.height < 50) return; // Skip icons

    img.classList.add("autocensor-pending");
    img.dataset.autocensorProcessed = "true";

    if (img.complete) {
      runInference(img);
    } else {
      img.addEventListener("load", () => runInference(img), { once: true });
    }
  }

  async function runInference(img) {
    if (!session) return;

    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      canvas.width = 320;
      canvas.height = 320;
      ctx.drawImage(img, 0, 0, 320, 320);

      const imageData = ctx.getImageData(0, 0, 320, 320);
      const input = new Float32Array(3 * 320 * 320);

      // Pre-process: RGB, Normalized to 0-1
      for (let i = 0; i < 320 * 320; i++) {
        input[i] = imageData.data[i * 4] / 255.0; // R
        input[i + 320 * 320] = imageData.data[i * 4 + 1] / 255.0; // G
        input[i + 2 * 320 * 320] = imageData.data[i * 4 + 2] / 255.0; // B
      }

      const tensor = new ort.Tensor("float32", input, [1, 3, 320, 320]);
      const results = await session.run({ images: tensor });
      const output = results.output0.data; // YOLOv8 output: [1, 22, 2100]

      const boxes = postProcess(output, img.naturalWidth, img.naturalHeight);
      applyCensoring(img, boxes);
    } catch (err) {
      console.error("[AutoCensor] Inference failed:", err);
      img.classList.remove("autocensor-pending");
    }
  }

  function postProcess(output, originalWidth, originalHeight) {
    const numClasses = 18;
    const numBoxes = 2100;
    const threshold = (config.threshold || DEFAULT_CONFIG.threshold) / 100;
    const detected = [];

    for (let i = 0; i < numBoxes; i++) {
      let maxScore = 0;
      let classIdx = -1;

      for (let c = 0; c < numClasses; c++) {
        const score = output[(4 + c) * numBoxes + i];
        if (score > maxScore) {
          maxScore = score;
          classIdx = c;
        }
      }

      if (maxScore > threshold) {
        const label = LABELS[classIdx];
        console.log("Label: " + label);
        if (labelsToCensor.includes(label)) {
          // YOLOv8 format: [cx, cy, w, h]
          const cx = output[0 * numBoxes + i];
          const cy = output[1 * numBoxes + i];
          const w = output[2 * numBoxes + i];
          const h = output[3 * numBoxes + i];

          const x1 = (cx - w / 2) * (originalWidth / 320);
          const y1 = (cy - h / 2) * (originalHeight / 320);
          const boxW = w * (originalWidth / 320);
          const boxH = h * (originalHeight / 320);

          detected.push({ x1, y1, boxW, boxH, label, score: maxScore });
        }
      }
    }

    return detected;
  }

  function applyCensoring(img, boxes) {
    if (boxes.length === 0) {
      img.classList.remove("autocensor-pending");
      img.classList.add("autocensor-processed");
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    boxes.forEach((box) => {
      console.log(
        `[AutoCensor] Censoring ${box.label} (${Math.round(box.score * 100)}%)`,
      );
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x1, box.y1, box.boxW, box.boxH);
      ctx.clip();
      ctx.filter = "blur(30px)";
      ctx.drawImage(canvas, 0, 0);
      ctx.restore();
    });

    img.src = canvas.toDataURL("image/jpeg");
    img.classList.remove("autocensor-pending");
    img.classList.add("autocensor-processed");
  }

  if (window.csLib) {
    init();
  } else {
    window.addEventListener("load", () => {
      if (window.csLib) init();
    });
  }
})();
