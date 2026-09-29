`eng.traineddata` is the English language model loaded by Tesseract.js for server-side receipt OCR. It was downloaded through the installed Tesseract.js default language-data source (`@tesseract.js-data/eng/4.0.0_best_int`) and is bundled locally so payment submission does not require a CDN request.

If upgrading Tesseract.js or its language model, run the OCR runtime check documented in `docs/PAYMENT_FLOW.md` before deployment.
