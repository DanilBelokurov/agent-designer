// Generates base-config.json for the Agent Designer.
// Run with: node scripts/generate-base-config.cjs

const fs = require('fs');
const path = require('path');

const ORCH_X_STEP = 520;
const AGENT_X_STEP = 220;
const SKILL_X_STEP = 200;
const Y_ORCH = 0;
const Y_AGENT = 320;
const Y_SKILL = 640;

// Each entry: { orchestrator, agents: [{ name, skills: [{ fn, desc }] }] }
const graph = [
  {
    orchestrator: {
      label: 'Аналитик требований',
      instructions:
        'Координирует работу по сбору, анализу и формализации требований. Делегирует задачи извлечения, декомпозиции, поиска граничных случаев, формализации и генерации критериев приёмки соответствующим диспатчируемым агентам.',
    },
    agents: [
      {
        label: 'Извлекатель требований',
        instructions:
          'Извлекает требования из пользовательских историй, технических заданий и постановок. Выделяет функциональные и нефункциональные требования, распознаёт неявные ожидания заказчика, синхронизирует результат с трекерами задач.',
        skills: [
          { fn: 'parse_user_stories_and_specs', desc: 'Парсинг пользовательских историй и ТЗ' },
          { fn: 'extract_functional_and_nonfunctional_requirements', desc: 'Выделение функциональных/нефункциональных требований' },
          { fn: 'detect_implicit_expectations', desc: 'Распознавание неявных ожиданий' },
          { fn: 'sync_with_task_trackers', desc: 'Интеграция с трекерами задач' },
        ],
      },
      {
        label: 'Декомпозитор задач',
        instructions:
          'Строит иерархию работ (WBS), выявляет зависимости между задачами, оценивает сложность и приоритизирует работу по методикам MoSCoW и RICE, формирует атомарные рабочие единицы.',
        skills: [
          { fn: 'build_wbs_tree', desc: 'Построение дерева задач (WBS)' },
          { fn: 'detect_task_dependencies', desc: 'Выявление зависимостей' },
          { fn: 'estimate_and_prioritize_moscow_rice', desc: 'Оценка сложности и приоритизация (MoSCoW, RICE)' },
          { fn: 'create_atomic_work_units', desc: 'Формирование атомарных рабочих единиц' },
        ],
      },
      {
        label: 'Аналитик граничных случаев',
        instructions:
          'Ищет edge cases на основе модели предметной области, применяет техники граничных значений, генерирует альтернативные и ошибочные сценарии, проверяет полноту требований.',
        skills: [
          { fn: 'apply_boundary_value_analysis', desc: 'Техники граничных значений' },
          { fn: 'analyze_edge_cases_from_domain', desc: 'Анализ edge cases на основе модели предметной области' },
          { fn: 'generate_alternative_and_error_scenarios', desc: 'Генерация альтернативных и ошибочных сценариев' },
          { fn: 'verify_requirements_completeness', desc: 'Проверка полноты требований' },
        ],
      },
      {
        label: 'Формализатор спецификаций',
        instructions:
          'Переводит неформальные требования в структурированный формат: use case, user story mapping, ubiquitous language. Фиксирует критерии готовности (Definition of Ready).',
        skills: [
          { fn: 'translate_to_structured_format', desc: 'Перевод в структурированный формат' },
          { fn: 'apply_use_case_and_user_story_mapping', desc: 'Нотации use case/user story mapping' },
          { fn: 'create_ubiquitous_language', desc: 'Создание Ubiquitous Language' },
          { fn: 'fix_definition_of_ready', desc: 'Фиксация критериев готовности (DoR)' },
        ],
      },
      {
        label: 'Генератор критериев приёмки',
        instructions:
          'Формулирует acceptance criteria в формате Given/When/Then (Gherkin), привязывает их к историям, обеспечивает измеримость и тестируемость, синхронизируется с инженером по тестированию.',
        skills: [
          { fn: 'write_gherkin_scenarios', desc: 'Запись Given/When/Then (Gherkin)' },
          { fn: 'link_acceptance_criteria_to_stories', desc: 'Привязка acceptance criteria к историям' },
          { fn: 'ensure_measurability_and_testability', desc: 'Обеспечение измеримости и тестируемости' },
          { fn: 'sync_with_test_engineer', desc: 'Синхронизация с инженером по тестированию' },
        ],
      },
    ],
  },
  {
    orchestrator: {
      label: 'Архитектор',
      instructions:
        'Отвечает за техническую архитектуру решения. Делегирует задачи проектирования высокоуровневой структуры, выбора паттернов, дизайна контрактов, оценки влияния на кодовую базу и проработки кросс-функциональных требований.',
    },
    agents: [
      {
        label: 'Проектировщик высокоуровневой структуры',
        instructions:
          'Декомпозирует систему на модули и сервисы, определяет границы контекстов в духе DDD, строит диаграммы компонентов и развёртывания, анализирует атрибуты качества.',
        skills: [
          { fn: 'decompose_into_modules_and_services', desc: 'Декомпозиция на модули/сервисы' },
          { fn: 'define_bounded_contexts_ddd', desc: 'Определение границ контекстов (DDD)' },
          { fn: 'build_component_and_deployment_diagrams', desc: 'Построение диаграмм компонентов и развёртывания' },
          { fn: 'analyze_quality_attributes', desc: 'Анализ атрибутов качества' },
        ],
      },
      {
        label: 'Селектор архитектурных паттернов',
        instructions:
          'Сопоставляет требования с каталогом паттернов (MVC, микросервисы, CQRS, Event Sourcing, Hexagonal Architecture), оценивает плюсы и минусы, документирует решения в формате ADR.',
        skills: [
          { fn: 'browse_pattern_catalog', desc: 'Каталог паттернов (MVC, микросервисы, CQRS, Event Sourcing, Hexagonal Architecture)' },
          { fn: 'match_patterns_to_requirements', desc: 'Сопоставление с требованиями' },
          { fn: 'evaluate_pros_and_cons', desc: 'Оценка плюсов/минусов' },
          { fn: 'document_decisions_in_adr', desc: 'Документирование в ADR' },
        ],
      },
      {
        label: 'Дизайнер контрактов',
        instructions:
          'Проектирует REST/GraphQL/gRPC API, нормализует/денормализует модели данных, определяет схему БД (таблицы, связи, индексы), планирует версионирование API.',
        skills: [
          { fn: 'design_rest_graphql_grpc_api', desc: 'Проектирование REST/GraphQL/gRPC' },
          { fn: 'normalize_and_denormalize_data_models', desc: 'Нормализация/денормализация моделей' },
          { fn: 'define_db_schema_indexes', desc: 'Определение схемы БД (таблицы, связи, индексы)' },
          { fn: 'version_api_contracts', desc: 'Версионирование API' },
        ],
      },
      {
        label: 'Оценщик влияния на кодовую базу',
        instructions:
          'Анализирует связность модулей, выявляет «горячие точки», прогнозирует объём изменений и рекомендует подходы, минимизирующие побочные эффекты.',
        skills: [
          { fn: 'analyze_module_coupling', desc: 'Анализ связности модулей' },
          { fn: 'detect_hot_spots', desc: 'Определение «горячих точек»' },
          { fn: 'forecast_change_volume', desc: 'Прогнозирование объёма изменений' },
          { fn: 'minimize_side_effects', desc: 'Рекомендации по минимизации побочных эффектов' },
        ],
      },
      {
        label: 'Проработчик кросс-функциональных требований',
        instructions:
          'Анализирует требования безопасности, производительности, надёжности и наблюдаемости, транслирует их в архитектурные решения, выбирает подходы к кэшированию, балансировке и шардированию.',
        skills: [
          { fn: 'analyze_security_performance_reliability_observability', desc: 'Анализ безопасности, производительности, надёжности, наблюдаемости' },
          { fn: 'translate_into_architectural_decisions', desc: 'Трансляция в архитектурные решения' },
          { fn: 'choose_caching_strategy', desc: 'Выбор подходов к кэшированию' },
          { fn: 'choose_balancing_and_sharding', desc: 'Балансировка и шардирование' },
        ],
      },
    ],
  },
  {
    orchestrator: {
      label: 'Разработчик',
      instructions:
        'Реализует кодовую базу. Делегирует задачи генерации чистого кода, реализации бизнес-логики, инспекции принципов проектирования, интеграции с внешними интерфейсами и документирования кода.',
    },
    agents: [
      {
        label: 'Генератор чистого кода',
        instructions:
          'Пишет идиоматичный код для выбранного языка и фреймворка, автоматически форматирует, даёт осмысленные имена, минимизирует сложность.',
        skills: [
          { fn: 'write_idiomatic_code', desc: 'Идиоматичное использование языка/фреймворка' },
          { fn: 'auto_format_code', desc: 'Автоматическое форматирование' },
          { fn: 'name_meaningfully', desc: 'Осмысленное именование' },
          { fn: 'minimize_complexity', desc: 'Минимизация сложности' },
        ],
      },
      {
        label: 'Реализатор бизнес-логики',
        instructions:
          'Транслирует спецификации в код, обрабатывает ошибки и реализует восстановление, реализует бизнес-правила как чистые функции и сервисы, отделяет логику от инфраструктуры.',
        skills: [
          { fn: 'translate_specs_to_code', desc: 'Трансляция спецификаций в код' },
          { fn: 'handle_errors_and_recovery', desc: 'Обработка ошибок и восстановление' },
          { fn: 'implement_business_rules_as_pure_functions', desc: 'Реализация бизнес-правил как чистых функций/сервисов' },
          { fn: 'separate_logic_from_infrastructure', desc: 'Разделение логики и инфраструктуры' },
        ],
      },
      {
        label: 'Инспектор принципов',
        instructions:
          'Проверяет код на соответствие принципам SOLID/KISS/DRY, выявляет нарушения DRY и предлагает абстракции, упрощает переусложнённый код, обеспечивает инверсию зависимостей.',
        skills: [
          { fn: 'check_solid_kiss_dry_principles', desc: 'Проверка соответствия принципам проектирования' },
          { fn: 'detect_dry_violations_and_suggest_abstractions', desc: 'Выявление нарушений DRY и предложение абстракций' },
          { fn: 'simplify_overengineered_code', desc: 'Упрощение переусложнённого кода' },
          { fn: 'ensure_dependency_inversion', desc: 'Обеспечение инверсии зависимостей' },
        ],
      },
      {
        label: 'Интегратор внешних интерфейсов',
        instructions:
          'Подключает приложение к БД, брокерам сообщений и внешним API, работает с ORM/ODM/DBAL, реализует репозитории, клиенты и адаптеры, обрабатывает сетевые ошибки, таймауты и повторные попытки.',
        skills: [
          { fn: 'connect_to_db_message_brokers_apis', desc: 'Подключение к БД, брокерам сообщений, внешним API' },
          { fn: 'work_with_orm_odm_dbal', desc: 'Работа с ORM/ODM/DBAL' },
          { fn: 'implement_repositories_clients_adapters', desc: 'Реализация репозиториев, клиентов, адаптеров' },
          { fn: 'handle_network_timeouts_and_retries', desc: 'Обработка сетевых ошибок, таймаутов, повторных попыток' },
        ],
      },
      {
        label: 'Документатор кода',
        instructions:
          'Пишет комментарии и JavaDoc/JSDoc, добавляет примеры в документацию, документирует сложные алгоритмы inline, поддерживает актуальность документации вместе с кодом.',
        skills: [
          { fn: 'write_comments_and_javadoc_jsdoc', desc: 'Написание комментариев и JavaDoc/JSDoc' },
          { fn: 'add_documentation_examples', desc: 'Добавление примеров в документацию' },
          { fn: 'inline_document_complex_algorithms', desc: 'Inline-документирование сложных алгоритмов' },
          { fn: 'keep_docs_in_sync_with_code', desc: 'Поддержание актуальности' },
        ],
      },
    ],
  },
  {
    orchestrator: {
      label: 'Инженер по тестированию',
      instructions:
        'Обеспечивает качество продукта через тестирование. Делегирует задачи разработки модульных, интеграционных и e2e-тестов, генерации тестовых данных, валидации граничных условий и анализа покрытия.',
    },
    agents: [
      {
        label: 'Разработчик модульных тестов',
        instructions:
          'Пишет изолированные юнит-тесты (Jest, pytest, JUnit), покрывает все пути выполнения, использует параметризованные тесты, проверяет утверждения и обработку ошибок.',
        skills: [
          { fn: 'write_isolated_unit_tests', desc: 'Написание изолированных юнит-тестов (Jest, pytest, JUnit)' },
          { fn: 'cover_all_execution_paths', desc: 'Покрытие всех путей выполнения' },
          { fn: 'write_parameterized_tests', desc: 'Параметризованные тесты' },
          { fn: 'assert_and_handle_errors_in_tests', desc: 'Проверка утверждений и обработки ошибок' },
        ],
      },
      {
        label: 'Разработчик интеграционных тестов',
        instructions:
          'Тестирует взаимодействие модулей и сервисов, настраивает тестовые окружения через контейнеры и WireMock, прогоняет сквозные сценарии с реальными зависимостями и обеспечивает очистку состояния.',
        skills: [
          { fn: 'test_module_interactions', desc: 'Тестирование взаимодействия модулей и сервисов' },
          { fn: 'provision_test_environments_containers_wiremock', desc: 'Настройка тестовых окружений (контейнеры, WireMock)' },
          { fn: 'run_end_to_end_scenarios_with_real_deps', desc: 'Сквозные сценарии с реальными зависимостями' },
          { fn: 'clean_up_state_between_tests', desc: 'Очистка состояния' },
        ],
      },
      {
        label: 'Разработчик e2e-тестов',
        instructions:
          'Описывает сценарии пользовательского поведения в Cypress/Playwright, прогоняет полный пайплайн от фронтенда до хранилища, применяет паттерны Page Object и Screenplay, интегрируется с CI.',
        skills: [
          { fn: 'write_user_behavior_scenarios', desc: 'Сценарии пользовательского поведения (Cypress, Playwright)' },
          { fn: 'run_frontend_to_storage_pipeline', desc: 'Полный пайплайн от фронтенда до хранилища' },
          { fn: 'apply_page_object_and_screenplay', desc: 'Паттерны Page Object, Screenplay' },
          { fn: 'integrate_e2e_with_ci', desc: 'Интеграция с CI' },
        ],
      },
      {
        label: 'Генератор тестовых данных и моков',
        instructions:
          'Создаёт фабрики тестовых объектов (Factory Boy, faker), генерирует реалистичные случайные данные, мокирует внешние сервисы (MSW, mockito), собирает наборы данных для граничных случаев.',
        skills: [
          { fn: 'build_test_object_factories', desc: 'Фабрики тестовых объектов (Factory Boy, faker)' },
          { fn: 'generate_realistic_random_data', desc: 'Генерация реалистичных случайных данных' },
          { fn: 'mock_external_services', desc: 'Мокирование внешних сервисов (MSW, mockito)' },
          { fn: 'build_edge_case_datasets', desc: 'Наборы данных для граничных случаев' },
        ],
      },
      {
        label: 'Валидатор граничных условий',
        instructions:
          'Тестирует крайние значения, пустые и нулевые входы, воспроизводит ошибочные состояния, проверяет инварианты и постусловия, проводит базовое нагрузочное тестирование.',
        skills: [
          { fn: 'test_boundary_and_null_inputs', desc: 'Тестирование крайних значений, пустых/нулевых входов' },
          { fn: 'reproduce_error_states', desc: 'Воспроизведение ошибочных состояний' },
          { fn: 'verify_invariants_and_postconditions', desc: 'Проверка инвариантов и постусловий' },
          { fn: 'run_baseline_load_tests', desc: 'Базовое нагрузочное тестирование' },
        ],
      },
      {
        label: 'Анализатор покрытия',
        instructions:
          'Измеряет покрытие кода (Istanbul, Coverage.py), выявляет непокрытые ветки, формирует отчёт с рекомендациями и проверяет качество самих тестов.',
        skills: [
          { fn: 'measure_code_coverage', desc: 'Измерение покрытия кода (Istanbul, Coverage.py)' },
          { fn: 'detect_uncovered_branches', desc: 'Выявление непокрытых веток' },
          { fn: 'report_coverage_with_recommendations', desc: 'Отчёт и рекомендации' },
          { fn: 'assess_test_quality', desc: 'Проверка качества тестов' },
        ],
      },
    ],
  },
  {
    orchestrator: {
      label: 'Код-ревьюер',
      instructions:
        'Проверяет качество изменений в кодовой базе. Делегирует задачи валидации лучших практик, обнаружения логических ошибок, оценки читаемости, советов по рефакторингу и трассировки требований.',
    },
    agents: [
      {
        label: 'Валидатор лучших практик',
        instructions:
          'Проверяет соответствие отраслевым стандартам для конкретного языка и фреймворка, контролирует код-стайл и соглашения, выявляет антипаттерны (God Object, Spaghetti Code) и предлагает улучшения.',
        skills: [
          { fn: 'apply_industry_standards', desc: 'Знание отраслевых стандартов для языка/фреймворка' },
          { fn: 'check_code_style_and_conventions', desc: 'Проверка код-стайла и соглашений' },
          { fn: 'detect_antipatterns', desc: 'Выявление антипаттернов (God Object, Spaghetti Code)' },
          { fn: 'suggest_code_improvements', desc: 'Предложение улучшений' },
        ],
      },
      {
        label: 'Детектор логических ошибок и узких мест',
        instructions:
          'Анализирует алгоритмы на корректность, ищет классические баги (off-by-one, race conditions), оценивает сложность по Big O, проверяет работу с памятью и ресурсами.',
        skills: [
          { fn: 'verify_algorithm_correctness', desc: 'Анализ алгоритмов на корректность' },
          { fn: 'detect_classic_bugs', desc: 'Обнаружение багов (off-by-one, race conditions)' },
          { fn: 'profile_big_o_complexity', desc: 'Профилирование по Big O' },
          { fn: 'audit_memory_and_resources', desc: 'Проверка работы с памятью/ресурсами' },
        ],
      },
      {
        label: 'Оценщик читаемости и сопровождаемости',
        instructions:
          'Оценивает ясность имён и размеры функций, проверяет комментарии «почему» (а не «что»), анализирует связность и зацепление, прогнозирует простоту будущих изменений.',
        skills: [
          { fn: 'assess_names_and_function_sizes', desc: 'Оценка ясности имён, размеров функций' },
          { fn: 'review_why_not_what_comments', desc: 'Проверка комментариев «почему», а не «что»' },
          { fn: 'analyze_cohesion_and_coupling', desc: 'Анализ связности и зацепления' },
          { fn: 'forecast_change_ease', desc: 'Прогноз простоты изменений' },
        ],
      },
      {
        label: 'Советник по рефакторингу',
        instructions:
          'Применяет конкретные техники рефакторинга (Extract Method, Introduce Parameter Object), безопасно переписывает код с сохранением поведения, использует автоматизированные рефакторинги и приоритизирует работу по кодовым запахам.',
        skills: [
          { fn: 'apply_refactoring_techniques', desc: 'Конкретные техники рефакторинга (Extract Method, Introduce Parameter Object)' },
          { fn: 'preserve_behavior_during_refactor', desc: 'Безопасное переписывание с сохранением поведения' },
          { fn: 'use_automated_refactors', desc: 'Автоматизированные рефакторинги' },
          { fn: 'prioritize_by_code_smells', desc: 'Приоритизация на основе кодовых запахов' },
        ],
      },
      {
        label: 'Трейсер требований',
        instructions:
          'Сопоставляет код с требованиями и issue, проверяет полноту реализации acceptance criteria, поддерживает traceability matrix (код → требование → тест), выявляет лишнюю функциональность.',
        skills: [
          { fn: 'map_code_to_requirements', desc: 'Сопоставление кода с требованиями/issue' },
          { fn: 'verify_acceptance_criteria_coverage', desc: 'Проверка полноты реализации acceptance criteria' },
          { fn: 'maintain_traceability_matrix', desc: 'Traceability matrix (код → требование → тест)' },
          { fn: 'detect_unneeded_functionality', desc: 'Выявление лишней функциональности' },
        ],
      },
    ],
  },
  {
    orchestrator: {
      label: 'DevOps-инженер',
      instructions:
        'Обеспечивает поставку и эксплуатацию системы. Делегирует задачи инженерии CI/CD, контейнеризации, управления окружениями и секретами, инфраструктуры как кода, настройки мониторинга и health-чеков.',
    },
    agents: [
      {
        label: 'Инженер CI/CD-пайплайнов',
        instructions:
          'Конфигурирует GitHub Actions, GitLab CI и Jenkins, выстраивает параллельные стадии, кэширует зависимости и артефакты, настраивает уведомления и автоматический откат.',
        skills: [
          { fn: 'configure_github_gitlab_jenkins_cicd', desc: 'Конфигурации GitHub Actions, GitLab CI, Jenkins' },
          { fn: 'parallelize_pipeline_stages', desc: 'Параллельные стадии' },
          { fn: 'cache_dependencies_and_artifacts', desc: 'Кэширование зависимостей и артефактов' },
          { fn: 'notify_and_auto_rollback', desc: 'Уведомления и автоматический откат' },
        ],
      },
      {
        label: 'Контейнеризатор',
        instructions:
          'Пишет эффективные многоступенчатые Dockerfile, поддерживает docker-compose для разработки, минимизирует размер образа и обеспечивает запуск от непривилегированного пользователя.',
        skills: [
          { fn: 'write_multistage_dockerfiles', desc: 'Эффективные Dockerfile (многоступенчатые сборки)' },
          { fn: 'maintain_docker_compose', desc: 'docker-compose для разработки' },
          { fn: 'minimize_image_size', desc: 'Минимизация размера образа' },
          { fn: 'run_as_non_root', desc: 'Не-root пользователи' },
        ],
      },
      {
        label: 'Менеджер окружений и секретов',
        instructions:
          'Управляет переменными окружения для разных сред, работает с HashiCorp Vault, SOPS, инжектит секреты в CI/CD, поддерживает актуальный .env.example и документацию.',
        skills: [
          { fn: 'manage_env_per_stage', desc: 'Переменные окружения для разных сред' },
          { fn: 'integrate_hashicorp_vault_and_sops', desc: 'Работа с vault/секретами (HashiCorp Vault, SOPS)' },
          { fn: 'inject_secrets_into_cicd', desc: 'Инжекция секретов в CI/CD' },
          { fn: 'maintain_env_example_and_docs', desc: 'Создание .env.example и документации' },
        ],
      },
      {
        label: 'Разработчик Infrastructure as Code',
        instructions:
          'Описывает инфраструктуру в Terraform, Pulumi или CloudFormation, версионирует и модуляризует код, планирует изменения и применяет их автоматически.',
        skills: [
          { fn: 'describe_infra_in_terraform_pulumi_cloudformation', desc: 'Описание инфраструктуры (Terraform, Pulumi, CloudFormation)' },
          { fn: 'version_iac_modules', desc: 'Версионирование и модульность' },
          { fn: 'plan_infrastructure_changes', desc: 'Планирование изменений' },
          { fn: 'auto_apply_infrastructure', desc: 'Автоматическое применение' },
        ],
      },
      {
        label: 'Конфигуратор мониторинга и health-чеков',
        instructions:
          'Настраивает сбор метрик (Prometheus, Datadog), строит дашборды и алерты, реализует readiness/liveness пробы в коде, подключает централизованное логирование (ELK, Loki) и трейсинг (OpenTelemetry).',
        skills: [
          { fn: 'collect_metrics_with_prometheus_datadog', desc: 'Сбор метрик (Prometheus, Datadog)' },
          { fn: 'build_dashboards_and_alerts', desc: 'Дашборды и алерты' },
          { fn: 'implement_readiness_and_liveness_probes', desc: 'Readiness/liveness пробы в коде' },
          { fn: 'centralize_logs_and_tracing', desc: 'Централизованное логирование (ELK, Loki) и трейсинг (OpenTelemetry)' },
        ],
      },
    ],
  },
  {
    orchestrator: {
      label: 'Специалист по безопасности',
      instructions:
        'Защищает систему от угроз. Делегирует задачи статического анализа уязвимостей, инъекционного тестирования, аудита аутентификации и авторизации, проверки зависимостей и безопасного хранения данных.',
    },
    agents: [
      {
        label: 'Статический анализатор уязвимостей',
        instructions:
          'Запускает SAST-инструменты (Semgrep, SonarQube, CodeQL), ищет уязвимости по OWASP Top 10 и CWE, проверяет конфигурации по CIS, интегрирует проверки в CI.',
        skills: [
          { fn: 'run_sast_semgrep_sonarqube_codeql', desc: 'Запуск SAST (Semgrep, SonarQube, CodeQL)' },
          { fn: 'search_owasp_top10_and_cwe', desc: 'Поиск уязвимостей по OWASP Top 10, CWE' },
          { fn: 'audit_cis_benchmarks', desc: 'Анализ конфигураций безопасности (CIS)' },
          { fn: 'integrate_sast_into_ci', desc: 'Интеграция в CI' },
        ],
      },
      {
        label: 'Инъекционный тестер',
        instructions:
          'Проверяет приложение на SQL-инъекции, XSS и command injection, анализирует обезвреживание ввода, проводит фаззинг, валидирует экранирование и параметризованные запросы.',
        skills: [
          { fn: 'test_sql_xss_command_injection', desc: 'Проверка на SQL-инъекции, XSS, command injection' },
          { fn: 'audit_input_sanitization', desc: 'Анализ обезвреживания ввода' },
          { fn: 'run_fuzzing', desc: 'Фаззинг' },
          { fn: 'verify_escaping_and_parameterized_queries', desc: 'Проверка экранирования и параметризованных запросов' },
        ],
      },
      {
        label: 'Аналитик аутентификации и авторизации',
        instructions:
          'Аудит механизмов входа (JWT/OAuth), проверяет ролевую модель (RBAC/ABAC), тестирует сценарии повышения привилегий, контролирует безопасное хранение токенов и паролей.',
        skills: [
          { fn: 'audit_jwt_and_oauth', desc: 'Аудит механизмов входа, JWT/OAuth' },
          { fn: 'review_rbac_and_abac_models', desc: 'Проверка ролевой модели (RBAC/ABAC)' },
          { fn: 'test_privilege_escalation', desc: 'Тестирование на повышение привилегий' },
          { fn: 'secure_tokens_and_passwords', desc: 'Безопасное хранение токенов и паролей' },
        ],
      },
      {
        label: 'Аудитор зависимостей',
        instructions:
          'Сканирует зависимости (npm audit, OWASP Dependency-Check), оценивает риск и рекомендует фиксы, проверяет целостность через SBOM, мониторит появление новых CVE.',
        skills: [
          { fn: 'scan_dependencies_npm_audit_owasp_dep_check', desc: 'Сканирование зависимостей (npm audit, OWASP Dependency-Check)' },
          { fn: 'assess_dependency_risk', desc: 'Оценка риска и рекомендации' },
          { fn: 'verify_sbom_integrity', desc: 'Проверка целостности (SBOM)' },
          { fn: 'monitor_new_cves', desc: 'Мониторинг новых CVE' },
        ],
      },
      {
        label: 'Советник по безопасному хранению данных',
        instructions:
          'Шифрует данные в покое и при передаче, маскирует чувствительные данные в логах, контролирует PII по GDPR/HIPAA, настраивает безопасные cookie, CORS и CSP.',
        skills: [
          { fn: 'encrypt_data_at_rest_and_in_transit', desc: 'Шифрование данных в покое и при передаче' },
          { fn: 'mask_sensitive_data_in_logs', desc: 'Маскирование чувствительных данных в логах' },
          { fn: 'enforce_pii_compliance_gdpr_hipaa', desc: 'Контроль PII (GDPR, HIPAA)' },
          { fn: 'configure_secure_cookies_cors_csp', desc: 'Настройка безопасных cookie, CORS, CSP' },
        ],
      },
    ],
  },
  {
    orchestrator: {
      label: 'Технический писатель',
      instructions:
        'Создаёт и поддерживает техническую документацию. Делегирует задачи генерации README, документирования API, ведения ADR, ведения CHANGELOG и автодокументирования кода.',
    },
    agents: [
      {
        label: 'Генератор README и инструкций',
        instructions:
          'Автоматически наполняет разделы README: установка, запуск, примеры; подтягивает реальные команды и пути из проекта; добавляет бейджи CI, покрытия и лицензии; адаптирует тон под аудиторию.',
        skills: [
          { fn: 'populate_readme_sections', desc: 'Автоматическое заполнение разделов: установка, запуск, примеры' },
          { fn: 'extract_real_commands_and_paths', desc: 'Реальные команды и пути из проекта' },
          { fn: 'add_status_badges', desc: 'Бейджи (CI, покрытие, лицензия)' },
          { fn: 'tailor_docs_for_audience', desc: 'Адаптация под аудиторию' },
        ],
      },
      {
        label: 'Документатор API',
        instructions:
          'Генерирует OpenAPI-спецификацию из кода и аннотаций, описывает эндпоинты, параметры, ответы и ошибки, синхронизирует спецификацию с кодом, публикует её в Swagger UI или Redoc.',
        skills: [
          { fn: 'generate_openapi_from_code', desc: 'Генерация спецификации из кода/аннотаций' },
          { fn: 'describe_endpoints_params_responses_errors', desc: 'Описание эндпоинтов, параметров, ответов, ошибок' },
          { fn: 'sync_openapi_with_code', desc: 'Синхронизация с кодом' },
          { fn: 'publish_swagger_ui_or_redoc', desc: 'Публикация (Swagger UI, Redoc)' },
        ],
      },
      {
        label: 'Архитектурный летописец',
        instructions:
          'Ведёт Architecture Decision Records по шаблону MADR/Nygard, фиксирует контекст, решение и последствия, хранит их в `docs/adr/`, связывает ADR с кодом и issue.',
        skills: [
          { fn: 'write_adr_by_template', desc: 'Ведение Architecture Decision Records по шаблону' },
          { fn: 'capture_context_decision_consequences', desc: 'Фиксация контекста, решения, последствий' },
          { fn: 'store_adrs_in_docs_adr', desc: 'Хранение в `docs/adr/`' },
          { fn: 'link_adrs_with_code_and_issues', desc: 'Связывание с кодом и issue' },
        ],
      },
      {
        label: 'Хронист CHANGELOG',
        instructions:
          'Генерирует журнал изменений на основе conventional commits, группирует записи по feat, fix и breaking, проставляет ссылки на issue и PR, готовит release notes.',
        skills: [
          { fn: 'generate_changelog_from_conventional_commits', desc: 'Генерация журнала изменений на основе conventional commits' },
          { fn: 'group_by_feat_fix_breaking', desc: 'Группировка feat, fix, breaking' },
          { fn: 'link_issue_and_pr', desc: 'Ссылки на issue и PR' },
          { fn: 'prepare_release_notes', desc: 'Подготовка release notes' },
        ],
      },
      {
        label: 'Автодокументатор кода',
        instructions:
          'Создаёт справочники API кода (JSDoc, pydoc, godoc), документирует публичные интерфейсы и типы, интегрируется с TypeDoc и Sphinx, проверяет полноту покрытия документацией.',
        skills: [
          { fn: 'generate_api_reference_jsdoc_pydoc_godoc', desc: 'Справочники API кода (JSDoc, pydoc, godoc)' },
          { fn: 'document_public_interfaces_and_types', desc: 'Документирование публичных интерфейсов и типов' },
          { fn: 'integrate_typedoc_and_sphinx', desc: 'Интеграция с TypeDoc, Sphinx' },
          { fn: 'verify_doc_coverage', desc: 'Проверка полноты покрытия документацией' },
        ],
      },
    ],
  },
];

function buildGraph() {
  const nodes = [];
  const edges = [];
  let orchCounter = 0;
  let agentCounter = 0;
  let skillCounter = 0;
  let edgeCounter = 0;

  for (const orch of graph) {
    orchCounter += 1;
    const orchId = `orch_${orchCounter}`;
    const orchX = (orchCounter - 1) * ORCH_X_STEP;

    nodes.push({
      id: orchId,
      type: 'orchestrator',
      label: orch.orchestrator.label,
      config: {
        instructions: orch.orchestrator.instructions,
        maxDelegations: 5,
      },
      position: { x: orchX, y: Y_ORCH },
    });

    const agentsCount = orch.agents.length;
    const agentsSpread = (agentsCount - 1) * AGENT_X_STEP;
    const agentsStartX = orchX - agentsSpread / 2;

    for (let aIdx = 0; aIdx < orch.agents.length; aIdx++) {
      const agent = orch.agents[aIdx];
      agentCounter += 1;
      const agentId = `agent_${agentCounter}`;
      const agentX = agentsStartX + aIdx * AGENT_X_STEP;

      nodes.push({
        id: agentId,
        type: 'sub_agent',
        label: agent.label,
        config: {
          instructions: agent.instructions,
          tools: [],
        },
        position: { x: agentX, y: Y_AGENT },
      });

      edgeCounter += 1;
      edges.push({
        id: `edge_${edgeCounter}`,
        source: orchId,
        target: agentId,
        edgeType: 'delegation',
      });

      const skillCount = agent.skills.length;
      const skillSpread = Math.max(0, (skillCount - 1) * SKILL_X_STEP);
      const skillStartX = agentX - skillSpread / 2;

      for (let sIdx = 0; sIdx < agent.skills.length; sIdx++) {
        const skill = agent.skills[sIdx];
        skillCounter += 1;
        const skillId = `skill_${skillCounter}`;
        const skillX = skillStartX + sIdx * SKILL_X_STEP;

        nodes.push({
          id: skillId,
          type: 'skill',
          label: skill.fn,
          config: {
            functionName: skill.fn,
            description: skill.desc,
            parameters: {},
          },
          position: { x: skillX, y: Y_SKILL },
        });

        edgeCounter += 1;
        edges.push({
          id: `edge_${edgeCounter}`,
          source: agentId,
          target: skillId,
          edgeType: 'skill_attachment',
        });
      }
    }
  }

  return {
    id: 'base-config-dev-team-2026-07-15',
    name: 'Базовая команда разработки',
    description:
      'Полная конфигурация графа агентов: 8 оркестраторов, 41 диспатчируемый агент и навыки для каждого. Готова к импорту в Agent Designer.',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    nodes,
    edges,
  };
}

const project = buildGraph();
const outPath = path.resolve(__dirname, '..', 'base-config.json');
fs.writeFileSync(outPath, JSON.stringify(project, null, 2), 'utf-8');

const orchCount = project.nodes.filter((n) => n.type === 'orchestrator').length;
const agentCount = project.nodes.filter((n) => n.type === 'sub_agent').length;
const skillCount = project.nodes.filter((n) => n.type === 'skill').length;

console.log(
  `Wrote ${outPath}\n` +
    `Orchestrators: ${orchCount}\n` +
    `Sub-agents:    ${agentCount}\n` +
    `Skills:        ${skillCount}\n` +
    `Edges:         ${project.edges.length}`
);
