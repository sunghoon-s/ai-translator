export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS 요청 처리 (CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text, targetLanguage } = req.body;

    // 입력 검증
    if (!text || !text.trim()) {
      return res.status(400).json({ error: '번역할 텍스트를 입력해주세요.' });
    }

    if (!targetLanguage) {
      return res.status(400).json({ error: '목표 언어를 선택해주세요.' });
    }

    // 환경변수에서 API 키 가져오기
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
    }

    const prompt = `
      You are an expert multilingual translator.
      First, detect the language of the provided "Source Text".
      Then, perform two translations: to ${targetLanguage} and to Korean.
      For each translation, provide a line-by-line phonetic transcription in Korean Hangul.

      **Crucial Instructions for Word Study List:**
      - The "wordStudy" list MUST be generated based on the words that appear in the **final ${targetLanguage} translation**, NOT from the original "Source Text".
      - If the target language is Japanese, English, OR Chinese, you MUST create this "wordStudy" list.
      - For **Japanese**: For each Kanji word **in the Japanese translation**, add an object to the list containing: 'originalWord' (the Kanji), 'koreanMeaning', 'reading' (the hiragana), and 'koreanPronunciation'.
      - For **English**: For each key vocabulary word **in the English translation**, add an object to the list containing: 'originalWord' (the English word), 'koreanMeaning', and 'reading' (the IPA phonetic transcription, e.g., /həˈloʊ/). The 'koreanPronunciation' field for English words should be an empty string.
      - For **Chinese**: For each key vocabulary word **in the Chinese translation**, add an object to the list containing: 'originalWord' (the Chinese word), 'koreanMeaning', 'reading' (the Pinyin with tone marks), and 'koreanPronunciation' (the Hangul representation of Pinyin).
      - If the source text is already Korean, the Korean translation should just be the original text.
      - Preserve all original line breaks in all translations.

      Return the result as a single JSON object that strictly follows the schema.

      Source Text: "${text}"
    `;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            detectedLanguage: { type: "STRING" },
            targetTranslation: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  translation: { type: "STRING" },
                  pronunciation: { type: "STRING" }
                }
              }
            },
            koreanTranslation: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  translation: { type: "STRING" },
                  pronunciation: { type: "STRING" }
                }
              }
            },
            wordStudy: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  originalWord: { type: "STRING" },
                  koreanMeaning: { type: "STRING" },
                  reading: { type: "STRING" },
                  koreanPronunciation: { type: "STRING" }
                },
                required: ["originalWord", "koreanMeaning"]
              }
            }
          },
          required: ["detectedLanguage", "targetTranslation", "koreanTranslation"]
        }
      }
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`API 요청 실패: ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error("API 응답 형식이 올바르지 않습니다.");
    }

    const translationData = JSON.parse(result.candidates[0].content.parts[0].text);
    
    return res.status(200).json({
      success: true,
      data: translationData
    });

  } catch (error) {
    console.error('번역 API 오류:', error);
    return res.status(500).json({ 
      error: '번역 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      details: error.message
    });
  }
}
