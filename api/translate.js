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
    const { text, customPrompt, translationStyle } = req.body;

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

    // 전문가 프롬프트 구성 (최적화된 버전)
    const expertPrompt = `
      **역할**: 자동차 제조업 전문가 | **목표**: 기술적이고 정확한 번역
      **스타일**: 전문 용어 사용, 간결하고 명확한 번역, 현장 실무 용어 활용
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

    // 원본 텍스트의 줄 수 확인
    const originalLineCount = text.trim().split('\n').filter(line => line.trim()).length;
    const isSingleLine = originalLineCount === 1;

    const prompt = `
      You are a multilingual translator specialized in automotive manufacturing.
      ${expertPrompt}${additionalPrompt}${stylePrompt}

      Detect source language, then translate to Japanese, Chinese, and English simultaneously, plus Korean.
      Provide Korean phonetic transcription for each translation.

      **Structure**: ${originalLineCount} line(s) - ${isSingleLine ? 'Keep as single line' : 'Preserve line breaks'}

      **Word Study**: Generate separate word study lists for each target language (Japanese, English, Chinese).
      - Japanese: originalWord (Kanji), koreanMeaning, reading (hiragana), koreanPronunciation
      - English: originalWord, koreanMeaning, reading (IPA)
      - Chinese: originalWord, koreanMeaning, reading (Pinyin), koreanPronunciation

      Source: "${sanitizedText}"
    `;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            detectedLanguage: { type: "STRING" },
            japaneseTranslation: {
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
            chineseTranslation: {
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
            englishTranslation: {
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
            japaneseWordStudy: {
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
            },
            chineseWordStudy: {
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
            },
            englishWordStudy: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  originalWord: { type: "STRING" },
                  koreanMeaning: { type: "STRING" },
                  reading: { type: "STRING" }
                },
                required: ["originalWord", "koreanMeaning"]
              }
            }
          },
          required: ["detectedLanguage", "japaneseTranslation", "chineseTranslation", "englishTranslation", "koreanTranslation"]
        },
        // 속도 최적화 설정
        temperature: 0.1,
        maxOutputTokens: 2048,
        topP: 0.8,
        topK: 10
      }
    };

    // Google Gemini API는 URL 파라미터 방식 사용 (속도 최적화된 모델)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      // 타임아웃 설정 (20초로 단축)
      signal: AbortSignal.timeout(20000)
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
    if (!translationData.detectedLanguage || !translationData.japaneseTranslation || !translationData.chineseTranslation || !translationData.englishTranslation || !translationData.koreanTranslation) {
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
