# Hermes에서 OpenAI Codex OAuth로 이미지 생성하기

이 절차는 Hermes Agent `v0.17.0`에서 실제 생성으로 검증했다. [최신 Hermes 공식 이미지 생성 문서](https://hermes-agent.nousresearch.com/docs/user-guide/features/image-generation)와 현재 세션의 `image_generate` 도구 설명이 이 문서보다 우선하며, provider capability가 달라졌다면 현재 도구 스키마를 따른다.

## 목적

Hermes 에이전트가 별도의 `OPENAI_API_KEY`나 `FAL_KEY` 없이, 기존 ChatGPT/OpenAI Codex OAuth 인증으로 이미지를 생성하는 방법이다.

## 필수 조건

1. OpenAI Codex OAuth 인증이 등록되어 있어야 한다.

   ```bash
   hermes auth list
   ```

   출력에 다음과 같은 항목이 있으면 된다.

   ```text
   openai-codex (... credentials)
   ```

   없다면 다음 명령으로 인증한다.

   ```bash
   hermes auth add openai-codex
   ```

2. `image_gen` 도구가 활성화되어 있어야 한다.

   ```bash
   hermes tools list
   ```

   비활성화 상태라면:

   ```bash
   hermes tools enable image_gen
   ```

3. OpenAI Codex 이미지 플러그인과 provider를 설정한다.

   ```bash
   hermes plugins enable openai-codex
   hermes config set image_gen.provider openai-codex
   hermes config set image_gen.model gpt-image-2-medium
   ```

   새로 플러그인이나 도구를 활성화했다면 Hermes를 재시작하거나 새 세션을 시작한다.

## 호출 확인

설정 확인을 위해 에이전트가 현재 세션에 노출된 `image_generate` 도구를 호출한다. 아래 payload는 설정 검증용 최소 예시이며, 프로젝트의 실제 후보 수·호출 예산·선택 기준은 `context/imagery.md`가 소유한다.

```json
{
  "prompt": "A minimal editorial illustration of a person studying at a desk",
  "aspect_ratio": "square"
}
```

지원 프리셋과 요청 기준 크기:

- `square`: 정사각형, 요청 기준 1024×1024
- `landscape`: 가로형, 요청 기준 1536×1024
- `portrait`: 세로형, 요청 기준 1024×1536

Provider가 반환한 실제 PNG 크기는 요청 기준 크기와 다를 수 있다. 설정 검증 시에는 결과 메타데이터만 믿지 말고 저장된 파일의 형식과 실제 픽셀 크기를 확인한다. 콘텐츠 프로젝트의 최종 검증은 해당 renderer의 프로젝트 validator와 render path를 따른다.

기본 모델은 `gpt-image-2-medium`이다. 필요하면 다음 중 하나를 설정할 수 있다.

```bash
hermes config set image_gen.model gpt-image-2-low
hermes config set image_gen.model gpt-image-2-medium
hermes config set image_gen.model gpt-image-2-high
```

생성 결과는 활성 Hermes 프로필의 홈 아래 다음 위치에 PNG로 저장된다.

```text
$HERMES_HOME/cache/images/
```

기본 프로필에서는 `~/.hermes/cache/images/`, 이름 있는 프로필에서는 예를 들어 다음과 같다.

```text
~/.hermes/profiles/<profile-name>/cache/images/
```

## 이미지 편집과 참고 이미지

현재 `openai-codex` provider의 `gpt-image-2-*` 모델은 텍스트 입력 기반 생성만 지원한다. 이 경로에서는 `image_url`이나 `reference_image_urls`를 전달하지 않는다. 이후 활성 도구 설명이 해당 입력을 명시적으로 지원할 때만 이미지 편집이나 참고 이미지 조건화를 사용한다.

## 문제 해결

### `FAL_KEY environment variable is not set`

OpenAI Codex 플러그인이 활성화되어 있어도 `image_gen.provider`가 누락되면 Hermes가 기본 FAL 경로로 떨어질 수 있다.

다음 설정을 다시 적용한다.

```bash
hermes config set image_gen.provider openai-codex
hermes config set image_gen.model gpt-image-2-medium
```

설정 파일에서 아래 구조가 존재하는지 확인한다.

```yaml
plugins:
  enabled:
    - image_gen/openai-codex

image_gen:
  provider: openai-codex
  model: gpt-image-2-medium
```

### OAuth 인증 오류

```bash
hermes auth list
hermes auth add openai-codex
```

필요하면 기존 인증을 갱신한 뒤 Hermes를 재시작한다.

### 설정 변경이 반영되지 않음

도구와 플러그인 구성은 세션 시작 시 로드될 수 있으므로 Hermes를 재시작하거나 `/reset`으로 새 세션을 연다.

## 에이전트용 핵심 체크리스트

1. 현재 Hermes 프로필을 확인한다.
2. `hermes auth list`에서 `openai-codex` OAuth를 확인한다.
3. `hermes tools list`에서 `image_gen` 활성화를 확인한다.
4. `openai-codex` 플러그인을 활성화한다.
5. `image_gen.provider`를 반드시 `openai-codex`로 지정한다.
6. `image_generate`를 실제 호출해 성공 결과와 생성 파일을 확인한다.
7. 필요하면 `vision_analyze`로 생성 이미지의 내용까지 검증한다.

> 중요: 플러그인이 활성화되어 있다는 사실만으로는 충분하지 않다. `image_gen.provider: openai-codex`가 없으면 FAL fallback 오류가 발생할 수 있다.
