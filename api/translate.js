const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // 정적 파일 서빙

// 환경변수에서 API 키 가져오기
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
    process.exit(1);
}

// 번역 API 엔드포인트
app.post('/api/translate', async (req, res) => {
    try {
        const { text, targetLanguage } = req.body;

        // 입력 검증
        if (!text || !targetLanguage) {
            return res.status(400).json({ 
                error: '텍스트와 목표 언어를 입력해주세요.' 
            });
        }

        // 텍스트 길이 제한 (남용 방지)
        if (text.length > 5000) {
            return res.status(400).json({ 
                error: '텍스트는 5000자를 초과할 수 없습니다.' 
            });
        }

        const prompt = `
            You are an expert multilingual translator.
            First, detect the language of the provided "Source Text".
            Then, perform two translations: to ${targetLanguage} and to Korean.
            For each translation, provide a line-by-line phonetic transcription in Korean Hangul.

            **Special Instructions for Word Study List:**
            - If the target language is Japanese, English, OR Chinese, you MUST create a "wordStudy" list.
            - For **Japanese**, for each Kanji word, add an object to the list containing: 'originalWord' (the Kanji), 'koreanMeaning', 'reading' (the hiragana), and 'koreanPronunciation'.
            - For **English**, for each key vocabulary word, add an object to the list containing: 'originalWord' (the English word), 'koreanMeaning', and 'reading' (the IPA phonetic transcription, e.g., /həˈloʊ/). The 'koreanPronunciation' field for English words should be an empty string.
            - For **Chinese**, for each key vocabulary word, add an object to the list containing: 'originalWord' (the Chinese word), 'koreanMeaning', 'reading' (the Pinyin with tone marks), and 'koreanPronunciation' (the Hangul representation of Pinyin).
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

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;

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
        res.json(translationData);

    } catch (error) {
        console.error('Translation error:', error);
        res.status(500).json({ 
            error: '번역 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' 
        });
    }
});

// 기본 라우트
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});