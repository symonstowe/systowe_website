(function () {
  function updatePreview(preview) {
    var frame = preview.querySelector(".employer_iframe");
    if (!frame) {
      return;
    }

    var baseWidth = parseFloat(frame.getAttribute("data-preview-width")) || 1200;
    var baseHeight = parseFloat(frame.getAttribute("data-preview-height")) || 900;
    var previewWidth = preview.clientWidth;
    var previewHeight = preview.clientHeight;

    if (!previewWidth || !previewHeight) {
      return;
    }

    var scale = Math.min(previewWidth / baseWidth, previewHeight / baseHeight);

    preview.style.aspectRatio = baseWidth + " / " + baseHeight;
    frame.style.width = baseWidth + "px";
    frame.style.height = baseHeight + "px";
    frame.style.transform = "translateZ(0) scale(" + scale + ")";
  }

  function updateAllPreviews() {
    var previews = document.querySelectorAll(".employer_preview");
    for (var i = 0; i < previews.length; i++) {
      updatePreview(previews[i]);
    }
  }

  function initResponsivePreviews() {
    var previews = document.querySelectorAll(".employer_preview");
    if (!previews.length) {
      return;
    }

    updateAllPreviews();

    if ("ResizeObserver" in window) {
      var observer = new ResizeObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          updatePreview(entries[i].target);
        }
      });

      for (var j = 0; j < previews.length; j++) {
        observer.observe(previews[j]);
      }
    }

    window.addEventListener("resize", function () {
      window.requestAnimationFrame(updateAllPreviews);
    });

    window.addEventListener("orientationchange", updateAllPreviews);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initResponsivePreviews);
  } else {
    initResponsivePreviews();
  }
})();
