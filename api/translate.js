export default async function handler(req, res) {
  // 환경변수 기반 CORS 헤더 설정
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:3000', 'http://localhost:8080'];
  
  const origin = req.headers.origin;
  
  // 개발 환경에서는 모든 localhost 허용
  if (process.env.NODE_ENV === 'development' && origin?.includes('localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  // 보안 헤더 추가
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // OPTIONS 요청 처리 (CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text, targetLanguage, customPrompt, translationStyle } = req.body;

    // 요청 본문 크기 확인
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: '요청 데이터가 없습니다.' });
    }

    // 강화된 입력 검증
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: '번역할 텍스트를 입력해주세요.' });
    }

    // 텍스트 길이 제한 (5000자)
    if (text.length > 5000) {
      return res.status(400).json({ error: '텍스트가 너무 깁니다. 5000자 이하로 입력해주세요.' });
    }

    // 최소 텍스트 길이 확인
    if (text.trim().length < 1) {
      return res.status(400).json({ error: '번역할 내용이 너무 짧습니다.' });
    }

    // 허용된 언어 목록 검증
    const allowedLanguages = ['Japanese', 'Chinese', 'English'];
    if (!targetLanguage || typeof targetLanguage !== 'string' || !allowedLanguages.includes(targetLanguage)) {
      return res.status(400).json({ error: '지원되지 않는 언어입니다.' });
    }

    // 커스텀 프롬프트 검증
    if (customPrompt && typeof customPrompt !== 'string') {
      return res.status(400).json({ error: '프롬프트 형식이 올바르지 않습니다.' });
    }

    // 커스텀 프롬프트 길이 제한 (500자)
    if (customPrompt && customPrompt.length > 500) {
      return res.status(400).json({ error: '프롬프트가 너무 깁니다. 500자 이하로 입력해주세요.' });
    }

    // 번역 스타일 검증
    const allowedStyles = ['formal', 'casual', 'business', 'academic', 'creative', 'literal'];
    if (translationStyle && !allowedStyles.includes(translationStyle)) {
      return res.status(400).json({ error: '지원되지 않는 번역 스타일입니다.' });
    }

    // 강화된 XSS 및 악성 콘텐츠 방지
    const dangerousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /vbscript:/gi,
      /onload\s*=/gi,
      /onerror\s*=/gi,
      /onclick\s*=/gi
    ];
    
    let sanitizedText = text;
    for (const pattern of dangerousPatterns) {
      const cleaned = sanitizedText.replace(pattern, '');
      if (cleaned !== sanitizedText) {
        return res.status(400).json({ error: '유효하지 않은 입력입니다.' });
      }
      sanitizedText = cleaned;
    }

    // 환경변수에서 API 키 가져오기
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
    }

    // 전문가 프롬프트 구성
    const expertPrompt = `
      **전문가 역할**: 너는 자동차 부품 제조사에 근무하는 생산기술 엔지니어이자 공정 개발 전문가야.
      주로 자동차 엔진에 사용되는 고정밀 부품의 가공(절삭/연삭) 및 조립/검사 공정을 잘 알고,
      공법을 개발하고 개선하는 엔지니어로서, 양산을 하기 위한 모든 기술적 검토를 하고 있어.

      **목표**: 최종적으로는 가격/품질/납기 등 가성비 있는 최적의 양산라인을 구축하는 게 목표야.
      제조공정 전반에 걸쳐, 기술적인 지식과 공정품질, 기술표준, 공정밸런스, 환경/안전 등 모든 것을
      아울러서 공정 개발을 하는 거야.

      **번역 스타일**: 
      - 전문적이고 기술적인 용어를 사용하며
      - 사실에 근거를 두고 정확하고, 간단하지만 구체적이고 명확한 번역
      - 최신의 공정 트렌드와 경쟁사들의 공법을 반영한 번역
      - 제조업 현장에서 실제 사용되는 전문 용어 활용
    `;

    // 사용자 커스텀 프롬프트가 있으면 추가
    const additionalPrompt = customPrompt ? `\n\n**추가 번역 지침**: ${customPrompt}` : '';

    // 번역 스타일 설정
    const styleInstructions = {
      formal: "격식 있고 공식적인 문체로 번역",
      casual: "친근하고 일상적인 문체로 번역", 
      business: "비즈니스 환경에 적합한 전문적 문체로 번역",
      academic: "학술적이고 정확한 문체로 번역",
      creative: "창의적이고 자연스러운 문체로 번역",
      literal: "원문에 충실한 직역 위주로 번역"
    };

    const stylePrompt = translationStyle ? `\n\n**번역 스타일**: ${styleInstructions[translationStyle]}` : '';

    const prompt = `
      You are an expert multilingual translator with specialized knowledge in automotive manufacturing.
      
      ${expertPrompt}${additionalPrompt}${stylePrompt}

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

      **중요**: 자동차 제조업계의 최신 기술 동향과 전문 용어를 반영하여 번역하세요.

      Return the result as a single JSON object that strictly follows the schema.

      Source Text: "${sanitizedText}"
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
                },
                required: ["translation", "pronunciation"]
              }
            },
            koreanTranslation: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  translation: { type: "STRING" },
                  pronunciation: { type: "STRING" }
                },
                required: ["translation", "pronunciation"]
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

    // Google Gemini API는 URL 파라미터 방식 사용 (Google 공식 방식)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      // 타임아웃 설정 (30초)
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API 오류:', response.status, errorText);
      throw new Error(`API 요청 실패: ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('예상치 못한 API 응답:', result);
      throw new Error("API 응답 형식이 올바르지 않습니다.");
    }

    let translationData;
    try {
      translationData = JSON.parse(result.candidates[0].content.parts[0].text);
    } catch (parseError) {
      console.error('JSON 파싱 오류:', parseError, result.candidates[0].content.parts[0].text);
      throw new Error("번역 결과를 처리할 수 없습니다.");
    }

    // 응답 데이터 검증
    if (!translationData.detectedLanguage || !translationData.targetTranslation || !translationData.koreanTranslation) {
      throw new Error("번역 결과가 완전하지 않습니다.");
    }
    
    return res.status(200).json({
      success: true,
      data: translationData
    });

  } catch (error) {
    console.error('번역 API 오류:', {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
    
    // 타임아웃 에러 처리
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      return res.status(408).json({ 
        error: '요청 시간이 초과되었습니다. 텍스트를 줄이고 다시 시도해 주세요.',
        code: 'REQUEST_TIMEOUT'
      });
    }
    
    // 네트워크 에러 처리
    if (error.message.includes('fetch failed') || error.message.includes('ENOTFOUND')) {
      return res.status(503).json({ 
        error: '번역 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        code: 'SERVICE_UNAVAILABLE'
      });
    }
    
    // API 에러 처리
    if (error.message.includes('API 요청 실패: 429')) {
      return res.status(429).json({ 
        error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
    
    if (error.message.includes('API 요청 실패: 401')) {
      return res.status(500).json({ 
        error: '인증에 문제가 발생했습니다.',
        code: 'AUTHENTICATION_ERROR'
      });
    }
    
    if (error.message.includes('API 요청 실패')) {
      return res.status(503).json({ 
        error: '번역 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        code: 'SERVICE_UNAVAILABLE'
      });
    }
    
    // 입력 검증 에러
    if (error.message.includes('텍스트가 너무 깁니다') || error.message.includes('유효하지 않은 입력')) {
      return res.status(400).json({ 
        error: error.message,
        code: 'INVALID_INPUT'
      });
    }
    
    // 기본 에러
    return res.status(500).json({ 
      error: '번역 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      code: 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
}
