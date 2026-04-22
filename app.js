const SAMPLE_DATA_SQL = `
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS students;

CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  major TEXT NOT NULL
);

CREATE TABLE courses (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  credits INTEGER NOT NULL
);

CREATE TABLE enrollments (
  student_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  semester TEXT NOT NULL,
  grade TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

INSERT INTO students (id, name, age, major) VALUES
  (1, 'Aish', 20, 'Computer Science'),
  (2, 'Sam', 17, 'History'),
  (3, 'Lena', 22, 'Mathematics'),
  (4, 'Diego', 19, 'Physics'),
  (5, 'Mina', 21, 'Computer Science'),
  (6, 'Ria', 18, 'Chemistry');

INSERT INTO courses (id, title, department, credits) VALUES
  (101, 'Databases 101', 'Computer Science', 4),
  (102, 'Linear Algebra', 'Mathematics', 3),
  (103, 'Modern World History', 'History', 3),
  (104, 'Classical Mechanics', 'Physics', 4),
  (105, 'Intro to Philosophy', 'Humanities', 2);

INSERT INTO enrollments (student_id, course_id, semester, grade) VALUES
  (1, 101, 'Spring 2026', 'A'),
  (1, 102, 'Spring 2026', 'B+'),
  (2, 103, 'Spring 2026', 'A-'),
  (3, 102, 'Spring 2026', 'A'),
  (4, 104, 'Spring 2026', 'B'),
  (5, 101, 'Spring 2026', 'A'),
  (5, 104, 'Spring 2026', 'A-');
`;

const EXAMPLE_QUERIES = [
  {
    label: "Select all students",
    query: "SELECT * FROM students;"
  },
  {
    label: "Adults only (age > 18)",
    query: "SELECT id, name, age FROM students WHERE age > 18;"
  },
  {
    label: "Students by age (descending)",
    query: "SELECT id, name, age FROM students ORDER BY age DESC;"
  },
  {
    label: "Computer Science students",
    query: "SELECT id, name, major FROM students WHERE major = 'Computer Science';"
  },
  {
    label: "Courses with at least 3 credits",
    query: "SELECT id, title, credits FROM courses WHERE credits >= 3 ORDER BY credits DESC, title;"
  },
  {
    label: "Students + enrolled courses (INNER JOIN)",
    query:
      "SELECT s.name, c.title, e.grade\nFROM students s\nJOIN enrollments e ON s.id = e.student_id\nJOIN courses c ON c.id = e.course_id\nWHERE s.age >= 18;"
  },
  {
    label: "Students with no enrollment (LEFT JOIN)",
    query:
      "SELECT s.id, s.name\nFROM students s\nLEFT JOIN enrollments e ON s.id = e.student_id\nWHERE e.student_id IS NULL;"
  },
  {
    label: "Enrollment count per course",
    query:
      "SELECT c.title, COUNT(e.student_id) AS enrolled_students\nFROM courses c\nLEFT JOIN enrollments e ON c.id = e.course_id\nGROUP BY c.id, c.title\nORDER BY enrolled_students DESC, c.title;"
  },
  {
    label: "Students per major",
    query:
      "SELECT major, COUNT(*) AS total_students\nFROM students\nGROUP BY major\nORDER BY total_students DESC, major;"
  },
  {
    label: "Students taking more than one course",
    query:
      "SELECT s.name, COUNT(e.course_id) AS course_count\nFROM students s\nJOIN enrollments e ON s.id = e.student_id\nGROUP BY s.id, s.name\nHAVING COUNT(e.course_id) > 1\nORDER BY course_count DESC;"
  },
  {
    label: "Average age of students",
    query: "SELECT ROUND(AVG(age), 2) AS avg_age FROM students;"
  }
];

const STORAGE_QUERY_KEY = "sql_playground_last_query";
const STORAGE_EXAMPLE_KEY = "sql_playground_example_index";
const STORAGE_HISTORY_KEY = "sql_playground_query_history";
const STORAGE_LAST_EXECUTION_KEY = "sql_playground_last_execution";
const SESSION_HAS_RUN_KEY = "sql_playground_has_run";
const MAX_HISTORY_ITEMS = 15;
const RESULT_PAGE_SIZE = 50;
const SQL_SCHEMA_HINTS = {
  students: ["id", "name", "age", "major"],
  courses: ["id", "title", "department", "credits"],
  enrollments: ["student_id", "course_id", "semester", "grade"]
};

const state = {
  db: null,
  hasRun: false,
  editor: null,
  resultSets: [],
  visibleRowsBySet: [],
  lastAnalysis: null,
  isLoading: false,
  joinConnectorFrame: 0,
  joinMatches: [],
  historyCursor: -1,
  historyDraft: "",
  isHistoryNavigating: false
};

const elements = {
  queryInput: document.getElementById("queryInput"),
  runQueryBtn: document.getElementById("runQueryBtn"),
  resetDbBtn: document.getElementById("resetDbBtn"),
  statusBar: document.getElementById("statusBar"),
  execTimeLabel: document.getElementById("execTimeLabel"),
  resultContainer: document.getElementById("resultContainer"),
  explanationText: document.getElementById("explanationText"),
  clauseList: document.getElementById("clauseList"),
  stepExecution: document.getElementById("stepExecution"),
  joinVisualizer: document.getElementById("joinVisualizer"),
  metricsLabel: document.getElementById("metricsLabel"),
  exampleSelect: document.getElementById("exampleSelect"),
  loadExampleBtn: document.getElementById("loadExampleBtn"),
  historyContainer: document.getElementById("historyContainer"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  difficultyBadge: document.getElementById("difficultyBadge"),
  difficultySummary: document.getElementById("difficultySummary"),
  editorCard: document.querySelector(".editor-card"),
  resultsCard: document.querySelector(".results-card")
};

init().catch((error) => {
  setStatus(`Initialization failed: ${error.message}`, "error");
});

async function init() {
  setStatus("Loading SQL engine...", "loading");

  const page = document.body?.dataset.page || "runner";
  const hasRunInSession = readSession(SESSION_HAS_RUN_KEY) === "1";
  setRunState(hasRunInSession);

  const savedQuery = readStorage(STORAGE_QUERY_KEY);
  const initialQuery = savedQuery || EXAMPLE_QUERIES[0].query;
  initializeEditor(initialQuery);
  renderDifficultyMeter(analyzeQuery(initialQuery), { isLive: page === "runner" });

  if (page !== "runner" && !hasRunInSession) {
    window.location.href = "index.html";
    return;
  }

  const SQL = await initSqlJs({
    locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
  });

  state.db = new SQL.Database();
  seedDatabase();
  setupExamples();
  setupInteractions();
  renderHistory();
  restoreExecutionTime();

  if (!savedQuery) {
    writeStorage(STORAGE_QUERY_KEY, initialQuery);
  }

  if (page !== "runner" && hasRunInSession) {
    await runCurrentQuery({ trackHistory: false });
  } else {
    setStatus("Sample tables loaded. Enter SQL and click Execute Query.", "ok");
  }
}

function initializeEditor(initialQuery) {
  if (!elements.queryInput) {
    return;
  }

  elements.queryInput.value = initialQuery;

  if (typeof window.CodeMirror !== "function") {
    return;
  }

  state.editor = window.CodeMirror.fromTextArea(elements.queryInput, {
    mode: "text/x-sqlite",
    lineNumbers: true,
    lineWrapping: true,
    matchBrackets: true,
    indentUnit: 2,
    tabSize: 2,
    smartIndent: true,
    extraKeys: {
      "Ctrl-Enter": () => runCurrentQuery(),
      "Cmd-Enter": () => runCurrentQuery(),
      "Ctrl-Space": "autocomplete",
      Tab: (editor) => editor.replaceSelection("  ", "end"),
      "Shift-Tab": "indentLess",
      Up: (editor) => {
        if (!handleEditorHistoryNavigation(editor, "up")) {
          editor.execCommand("goLineUp");
        }
      },
      Down: (editor) => {
        if (!handleEditorHistoryNavigation(editor, "down")) {
          editor.execCommand("goLineDown");
        }
      }
    },
    hint: window.CodeMirror.hint?.sql,
    hintOptions: {
      tables: SQL_SCHEMA_HINTS,
      defaultTable: "students"
    }
  });

  state.editor.setValue(initialQuery);
  state.editor.on("change", (editor) => {
    const nextValue = editor.getValue();
    if (elements.queryInput) {
      elements.queryInput.value = nextValue;
    }
    writeStorage(STORAGE_QUERY_KEY, nextValue);
    renderDifficultyMeter(analyzeQuery(nextValue), { isLive: true });
    if (!state.isHistoryNavigating) {
      resetHistoryNavigation();
    }
  });
}

function seedDatabase() {
  state.db.run(SAMPLE_DATA_SQL);
  setStatus("Sample tables loaded. Ready.", "ok");
}

function setupExamples() {
  if (!elements.exampleSelect) {
    return;
  }

  elements.exampleSelect.innerHTML = EXAMPLE_QUERIES.map(
    (item, index) => `<option value="${index}">${escapeHtml(item.label)}</option>`
  ).join("");

  const savedIndex = Number(readStorage(STORAGE_EXAMPLE_KEY) ?? 0);
  const safeIndex = Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < EXAMPLE_QUERIES.length
    ? savedIndex
    : 0;
  elements.exampleSelect.value = String(safeIndex);
}

function setupInteractions() {
  if (elements.runQueryBtn) {
    elements.runQueryBtn.addEventListener("click", () => {
      runCurrentQuery();
    });
  }

  if (elements.resetDbBtn) {
    elements.resetDbBtn.addEventListener("click", () => {
      seedDatabase();
      setStatus("Database reset to sample data.", "ok");
      runCurrentQuery();
    });
  }

  if (elements.loadExampleBtn && elements.exampleSelect && elements.queryInput) {
    elements.loadExampleBtn.addEventListener("click", () => {
      const selectedIndex = Number(elements.exampleSelect.value);
      const selected = EXAMPLE_QUERIES[selectedIndex] ?? EXAMPLE_QUERIES[0];
      writeStorage(STORAGE_EXAMPLE_KEY, String(selectedIndex));
      setQueryValue(selected.query);
      renderDifficultyMeter(analyzeQuery(selected.query), { isLive: true });
      setStatus("Example query loaded. Press Execute Query.", "ok");
    });
  }

  if (elements.queryInput && !state.editor) {
    elements.queryInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        runCurrentQuery();
        return;
      }

      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        insertTextAtCursor(elements.queryInput, "  ");
        return;
      }

      if (event.key === "ArrowUp" && handleTextareaHistoryNavigation(elements.queryInput, "up")) {
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowDown" && handleTextareaHistoryNavigation(elements.queryInput, "down")) {
        event.preventDefault();
      }
    });

    elements.queryInput.addEventListener("input", () => {
      writeStorage(STORAGE_QUERY_KEY, elements.queryInput.value);
      renderDifficultyMeter(analyzeQuery(elements.queryInput.value), { isLive: true });
      if (!state.isHistoryNavigating) {
        resetHistoryNavigation();
      }
    });
  }

  if (elements.historyContainer) {
    elements.historyContainer.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const historyButton = target.closest("[data-history-index]");
      if (!(historyButton instanceof HTMLElement)) {
        return;
      }

      const index = Number(historyButton.dataset.historyIndex);
      const history = readHistory();
      const selectedEntry = history[index];
      if (!selectedEntry) {
        return;
      }

      setQueryValue(selectedEntry.query);
      renderDifficultyMeter(analyzeQuery(selectedEntry.query), {
        isLive: Boolean(elements.queryInput || state.editor)
      });
      resetHistoryNavigation();

      if (elements.queryInput || state.editor) {
        setStatus("Loaded query from history. Press Execute Query.", "ok");
      } else {
        setStatus("Loaded query from history. Refreshing analysis...", "loading");
        runCurrentQuery({ trackHistory: false });
      }
    });
  }

  if (elements.resultContainer) {
    elements.resultContainer.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const loadMoreButton = target.closest("[data-result-index]");
      if (!(loadMoreButton instanceof HTMLElement)) {
        return;
      }

      const resultIndex = Number(loadMoreButton.dataset.resultIndex);
      if (!Number.isInteger(resultIndex) || !state.resultSets[resultIndex]) {
        return;
      }

      state.visibleRowsBySet[resultIndex] = Math.min(
        (state.visibleRowsBySet[resultIndex] || RESULT_PAGE_SIZE) + RESULT_PAGE_SIZE,
        state.resultSets[resultIndex].values.length
      );
      renderResultSets();
    });
  }

  if (elements.clearHistoryBtn) {
    elements.clearHistoryBtn.addEventListener("click", () => {
      writeHistory([]);
      renderHistory();
      setStatus("Query history cleared.", "ok");
    });
  }

  window.addEventListener("resize", () => {
    scheduleJoinConnectorRender();
  });
}

async function runCurrentQuery(options = { trackHistory: true }) {
  const rawQuery = getCurrentQuery();
  if (!rawQuery) {
    setStatus("Please enter a SQL query before running.", "error");
    return;
  }

  writeStorage(STORAGE_QUERY_KEY, rawQuery);
  const analysis = analyzeQuery(rawQuery);
  renderDifficultyMeter(analysis);
  const startedAt = performance.now();
  const shouldTrackHistory = options.trackHistory !== false;
  setLoadingState(true);
  setStatus("Executing query...", "loading");
  await waitForNextPaint();

  try {
    const resultSets = state.db.exec(rawQuery);
    const elapsed = Number((performance.now() - startedAt).toFixed(2));

    setRunState(true);
    state.lastAnalysis = analysis;
    setResultSets(resultSets);
    renderExplanation(analysis);
    renderExecutionSteps(analysis, rawQuery);
    renderJoinVisualizer(analysis);

    const rowCount = resultSets.reduce((sum, set) => sum + set.values.length, 0);
    if (elements.metricsLabel) {
      elements.metricsLabel.textContent = `${rowCount} rows in ${elapsed.toFixed(2)} ms`;
    }
    setExecutionTime(elapsed, rowCount);
    if (shouldTrackHistory) {
      addHistoryEntry({
        query: rawQuery,
        elapsedMs: elapsed,
        rowCount,
        success: true
      });
    }
    setStatus("Query executed successfully.", "ok");
  } catch (error) {
    const elapsed = Number((performance.now() - startedAt).toFixed(2));
    const guidance = buildSqlErrorGuidance(rawQuery, error.message);
    renderError(error.message, guidance.detail);
    if (elements.metricsLabel) {
      elements.metricsLabel.textContent = "";
    }
    state.resultSets = [];
    state.visibleRowsBySet = [];
    setExecutionTime(elapsed, 0, true);
    if (shouldTrackHistory) {
      addHistoryEntry({
        query: rawQuery,
        elapsedMs: elapsed,
        rowCount: 0,
        success: false,
        error: error.message
      });
    }
    setStatus(`SQL error: ${error.message} - ${guidance.short}`, "error");
  } finally {
    setLoadingState(false);
  }
}

function setResultSets(resultSets) {
  state.resultSets = resultSets;
  state.visibleRowsBySet = resultSets.map(() => RESULT_PAGE_SIZE);
  renderResultSets();
}

function renderResultSets() {
  if (!elements.resultContainer) {
    return;
  }

  const resultSets = state.resultSets;
  if (!resultSets.length) {
    elements.resultContainer.innerHTML =
      '<p class="empty">Query ran successfully. This statement did not return rows.</p>';
    return;
  }

  const fragments = resultSets.map((set, index) => {
    const visibleCount = Math.min(
      state.visibleRowsBySet[index] || RESULT_PAGE_SIZE,
      set.values.length
    );
    const canLoadMore = visibleCount < set.values.length;
    const tableMarkup = renderTableMarkup(set.columns, set.values.slice(0, visibleCount));
    const loadMoreMarkup = canLoadMore
      ? `
        <div class="result-actions">
          <p class="result-progress">Showing ${visibleCount} of ${set.values.length} rows</p>
          <button class="btn ghost btn-compact" type="button" data-result-index="${index}">
            Load More
          </button>
        </div>
      `
      : set.values.length > RESULT_PAGE_SIZE
        ? `<div class="result-actions"><p class="result-progress">Showing all ${set.values.length} rows</p></div>`
        : "";

    return `
      <section class="result-set">
        <p class="result-caption">Result Set ${index + 1} - ${set.values.length} rows</p>
        ${tableMarkup}
        ${loadMoreMarkup}
      </section>
    `;
  });

  elements.resultContainer.innerHTML = fragments.join("");
}

function renderExplanation(analysis) {
  if (!elements.explanationText || !elements.clauseList) {
    return;
  }

  elements.explanationText.textContent = analysis.summary;

  if (!analysis.clauses.length) {
    elements.clauseList.innerHTML = '<p class="empty">No SQL clauses could be extracted.</p>';
    return;
  }

  elements.clauseList.innerHTML = analysis.clauses
    .map(
      (clause) => `
        <div class="clause">
          <p class="clause-label">${escapeHtml(clause.label)}</p>
          <p class="clause-value">${escapeHtml(clause.value)}</p>
        </div>
      `
    )
    .join("");
}

function renderExecutionSteps(analysis, rawQuery) {
  if (!elements.stepExecution) {
    return;
  }

  if (analysis.kind !== "select" || !analysis.fromClause) {
    elements.stepExecution.innerHTML =
      '<p class="empty">Run a <code>SELECT</code> query to preview FROM, WHERE, and SELECT steps.</p>';
    return;
  }

  const steps = [];

  steps.push({
    title: "1. FROM",
    description: `Reads rows from ${analysis.fromClause}`,
    query: `SELECT * FROM ${analysis.fromClause} LIMIT 8;`
  });

  if (analysis.whereClause) {
    steps.push({
      title: "2. WHERE",
      description: `Filters using ${analysis.whereClause}`,
      query: `SELECT * FROM ${analysis.fromClause} WHERE ${analysis.whereClause} LIMIT 8;`
    });
  }

  const normalized = stripTrailingSemicolon(rawQuery);
  steps.push({
    title: analysis.whereClause ? "3. SELECT" : "2. SELECT",
    description: "Returns projected columns",
    query: `SELECT * FROM (${normalized}) AS final_result LIMIT 8;`
  });

  elements.stepExecution.innerHTML = steps
    .map((step) => {
      const preview = runPreview(step.query);
      const body = preview.ok
        ? renderTableMarkup(preview.columns, preview.rows)
        : `<div class="error-box">${escapeHtml(preview.error)}</div>`;

      return `
        <article class="step-card">
          <header class="step-head">
            <p class="step-title">${escapeHtml(step.title)}</p>
            <p class="step-desc">${escapeHtml(step.description)}</p>
          </header>
          <div class="step-body">${body}</div>
        </article>
      `;
    })
    .join("");
}

function renderJoinVisualizer(analysis) {
  if (!elements.joinVisualizer) {
    return;
  }

  const join = analysis.joins[0];
  if (!join || !analysis.primaryFromTable) {
    state.joinMatches = [];
    elements.joinVisualizer.innerHTML =
      '<p class="empty">Run a query with <code>JOIN</code> to highlight matching rows.</p>';
    return;
  }

  const leftTable = analysis.primaryFromTable.table;
  const leftAlias = analysis.primaryFromTable.alias || leftTable;
  const rightTable = join.table;
  const rightAlias = join.alias || rightTable;

  if (!isSafeIdentifier(leftTable) || !isSafeIdentifier(rightTable) || !isSafeIdentifier(leftAlias) || !isSafeIdentifier(rightAlias)) {
    state.joinMatches = [];
    elements.joinVisualizer.innerHTML =
      '<p class="empty">JOIN visualizer supports simple unquoted identifiers (letters, numbers, underscore).</p>';
    return;
  }

  const leftRows = fetchRowsWithRowId(leftTable);
  const rightRows = fetchRowsWithRowId(rightTable);
  const matchResult = fetchJoinMatches(leftTable, leftAlias, rightTable, rightAlias, join.condition);

  if (!leftRows.ok || !rightRows.ok || !matchResult.ok) {
    state.joinMatches = [];
    const message = [leftRows.error, rightRows.error, matchResult.error].filter(Boolean).join(" | ");
    elements.joinVisualizer.innerHTML = `<div class="error-box">${escapeHtml(message)}</div>`;
    return;
  }

  const leftMatches = new Set(matchResult.matches.map((item) => item.left));
  const rightMatches = new Set(matchResult.matches.map((item) => item.right));
  state.joinMatches = matchResult.matches;

  const relationshipMarkup = renderJoinRelationshipMap(
    leftTable,
    rightTable,
    leftRows.columns,
    leftRows.rows,
    rightRows.columns,
    rightRows.rows,
    matchResult.matches,
    leftMatches,
    rightMatches
  );
  const leftTableMarkup = renderJoinTable(leftRows.columns, leftRows.rows, leftMatches);
  const rightTableMarkup = renderJoinTable(rightRows.columns, rightRows.rows, rightMatches);

  elements.joinVisualizer.innerHTML = `
    <p class="join-meta">
      JOIN condition: <code>${escapeHtml(join.condition)}</code> |
      Matches found: <strong>${matchResult.matches.length}</strong>
    </p>
    ${relationshipMarkup}
    <div class="join-panels">
      <section>
        <p class="join-table-title">${escapeHtml(leftTable)} (${escapeHtml(leftAlias)})</p>
        ${leftTableMarkup}
      </section>
      <section>
        <p class="join-table-title">${escapeHtml(rightTable)} (${escapeHtml(rightAlias)})</p>
        ${rightTableMarkup}
      </section>
    </div>
  `;
  scheduleJoinConnectorRender();
}

function analyzeQuery(rawQuery) {
  const compact = normalizeSql(rawQuery);
  const lowered = compact.toLowerCase();
  const kind = lowered.startsWith("select") ? "select" : "other";

  if (kind !== "select") {
    return {
      kind,
      summary:
        "This statement is not a SELECT query. The explanation and execution preview are focused on SELECT syntax.",
      clauses: [],
      joins: [],
      primaryFromTable: null,
      fromClause: "",
      whereClause: "",
      groupClause: "",
      havingClause: "",
      difficulty: {
        label: "Statement",
        tone: "statement",
        summary: "Breakdown, execution, and JOIN previews support basic SELECT queries best."
      }
    };
  }

  const selectClause = extractClause(compact, "select", [
    "from"
  ]);
  const fromClause = extractClause(compact, "from", [
    "where",
    "group by",
    "having",
    "order by",
    "limit",
    "union"
  ]);
  const whereClause = extractClause(compact, "where", [
    "group by",
    "having",
    "order by",
    "limit",
    "union"
  ]);
  const groupClause = extractClause(compact, "group by", [
    "having",
    "order by",
    "limit",
    "union"
  ]);
  const havingClause = extractClause(compact, "having", [
    "order by",
    "limit",
    "union"
  ]);
  const orderClause = extractClause(compact, "order by", ["limit", "union"]);
  const limitClause = extractClause(compact, "limit", ["union"]);
  const joins = extractJoinClauses(compact);

  const primaryFromTable = parsePrimaryFrom(compact);
  const summary = buildSummary(selectClause, fromClause, whereClause, joins.length);
  const difficulty = assessDifficulty({
    compact,
    joins,
    whereClause,
    groupClause,
    havingClause,
    orderClause,
    limitClause
  });

  const clauses = [];
  if (selectClause) {
    clauses.push({ label: "SELECT", value: selectClause });
  }
  if (fromClause) {
    clauses.push({ label: "FROM", value: fromClause });
  }
  if (whereClause) {
    clauses.push({ label: "WHERE", value: whereClause });
  }
  if (groupClause) {
    clauses.push({ label: "GROUP BY", value: groupClause });
  }
  if (havingClause) {
    clauses.push({ label: "HAVING", value: havingClause });
  }
  joins.forEach((join, index) => {
    clauses.push({ label: `JOIN ${index + 1}`, value: `${join.table} ON ${join.condition}` });
  });
  if (orderClause) {
    clauses.push({ label: "ORDER BY", value: orderClause });
  }
  if (limitClause) {
    clauses.push({ label: "LIMIT", value: limitClause });
  }

  return {
    kind,
    summary,
    clauses,
    joins,
    primaryFromTable,
    fromClause,
    whereClause,
    groupClause,
    havingClause,
    difficulty
  };
}

function buildSummary(selectClause, fromClause, whereClause, joinCount) {
  if (!fromClause) {
    return `You are selecting ${selectClause || "columns"}, but a FROM clause could not be parsed.`;
  }

  let sentence = `You are selecting ${selectClause || "columns"} from ${fromClause}`;
  if (whereClause) {
    sentence += ` where ${whereClause}`;
  }
  sentence += ".";

  if (joinCount > 0) {
    sentence += ` This query also performs ${joinCount} JOIN operation${joinCount > 1 ? "s" : ""}.`;
  }

  return sentence;
}

function assessDifficulty({ compact, joins, whereClause, groupClause, havingClause, orderClause, limitClause }) {
  const joinCount = joins.length;
  const hasSubquery = /\(\s*select\b/i.test(compact);
  const hasAggregate = /\b(count|avg|sum|min|max)\s*\(/i.test(compact);
  const score =
    1 +
    (whereClause ? 0.35 : 0) +
    joinCount * 0.9 +
    (groupClause ? 0.95 : 0) +
    (havingClause ? 0.7 : 0) +
    (orderClause ? 0.25 : 0) +
    (limitClause ? 0.15 : 0) +
    (hasAggregate ? 0.6 : 0) +
    (hasSubquery ? 1.45 : 0);

  if (score < 2.1) {
    return {
      label: "Basic",
      tone: "basic",
      summary: "Single-table lookup with light filtering or ordering."
    };
  }

  if (score < 4.1) {
    return {
      label: "Intermediate",
      tone: "intermediate",
      summary: "Uses JOINs, grouping, or a few layered clauses."
    };
  }

  return {
    label: "Advanced",
    tone: "advanced",
    summary: hasSubquery
      ? "Includes subqueries or several layered operations."
      : "Combines several clauses and heavier relational logic."
  };
}

function extractJoinClauses(sql) {
  const joinRegex =
    /\bjoin\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?\s+on\s+(.+?)(?=\bjoin\b|\bwhere\b|\bgroup\b|\border\b|\blimit\b|\bhaving\b|$)/gi;
  const matches = [];
  let match;

  while ((match = joinRegex.exec(sql)) !== null) {
    matches.push({
      table: match[1],
      alias: match[2] || "",
      condition: match[3].trim()
    });
  }

  return matches;
}

function parsePrimaryFrom(sql) {
  const fromRegex = /\bfrom\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/i;
  const match = fromRegex.exec(sql);
  if (!match) {
    return null;
  }

  return {
    table: match[1],
    alias: match[2] || ""
  };
}

function extractClause(sql, keyword, stops) {
  const stopPart = stops.map((item) => item.replace(/\s+/g, "\\s+")).join("|");
  const pattern = new RegExp(
    `\\b${keyword.replace(/\s+/g, "\\s+")}\\b\\s+([\\s\\S]*?)(?=\\b(?:${stopPart})\\b|$)`,
    "i"
  );
  const match = sql.match(pattern);
  return match ? match[1].trim() : "";
}

function runPreview(query) {
  try {
    const previewResult = state.db.exec(query);
    if (!previewResult.length) {
      return { ok: true, columns: ["status"], rows: [["No rows returned"]] };
    }
    const first = previewResult[0];
    return {
      ok: true,
      columns: first.columns,
      rows: first.values
    };
  } catch (error) {
    return {
      ok: false,
      error: `Preview failed: ${error.message}`
    };
  }
}

function fetchRowsWithRowId(table) {
  try {
    const query = `SELECT rowid AS __rowid__, * FROM ${table} LIMIT 8`;
    const result = state.db.exec(query);
    if (!result.length) {
      return { ok: true, columns: [], rows: [] };
    }
    return {
      ok: true,
      columns: result[0].columns,
      rows: result[0].values
    };
  } catch (error) {
    return {
      ok: false,
      error: `Unable to preview ${table}: ${error.message}`
    };
  }
}

function fetchJoinMatches(leftTable, leftAlias, rightTable, rightAlias, condition) {
  try {
    const query = `
      SELECT ${leftAlias}.rowid AS left_rowid, ${rightAlias}.rowid AS right_rowid
      FROM ${leftTable} ${leftAlias}
      JOIN ${rightTable} ${rightAlias}
      ON ${condition}
      LIMIT 80
    `;
    const result = state.db.exec(query);
    if (!result.length) {
      return { ok: true, matches: [] };
    }
    const matches = result[0].values.map((row) => ({
      left: Number(row[0]),
      right: Number(row[1])
    }));
    return {
      ok: true,
      matches
    };
  } catch (error) {
    return {
      ok: false,
      error: `JOIN visualization failed: ${error.message}`
    };
  }
}

function renderJoinRelationshipMap(
  leftTable,
  rightTable,
  leftColumns,
  leftRows,
  rightColumns,
  rightRows,
  matches,
  leftMatches,
  rightMatches
) {
  const pairPreview = matches.length
    ? matches
      .slice(0, 8)
      .map(
        (match) =>
          `<span class="join-pair">${escapeHtml(leftTable)} row ${match.left} -> ${escapeHtml(rightTable)} row ${match.right}</span>`
      )
      .join("")
    : '<span class="join-pair">No matching pairs found in the current preview.</span>';

  return `
    <section class="join-relationship-card">
      <div class="join-diagram-wrap">
        <div class="join-diagram" data-join-diagram>
          ${renderJoinNodeColumn("left", leftColumns, leftRows, leftMatches, leftTable)}
          <svg class="join-lines" aria-hidden="true"></svg>
          ${renderJoinNodeColumn("right", rightColumns, rightRows, rightMatches, rightTable)}
        </div>
      </div>
      <div class="join-pair-list">${pairPreview}</div>
    </section>
  `;
}

function renderJoinNodeColumn(side, columns, rows, matchSet, tableName) {
  if (!rows.length) {
    return `<div class="join-node-column" data-join-side="${side}"><p class="empty">No rows.</p></div>`;
  }

  const visibleColumns = columns.filter((column) => column !== "__rowid__");
  const nodes = rows
    .map((row) => {
      const rowId = Number(row[0]);
      const preview = buildJoinNodePreview(visibleColumns, row.slice(1));
      const title = row[1] ?? `${tableName} row ${rowId}`;
      const className = matchSet.has(rowId) ? "join-node is-match" : "join-node";

      return `
        <article class="${className}" data-join-side="${side}" data-rowid="${rowId}">
          <span class="join-node-id">${escapeHtml(tableName)} row ${rowId}</span>
          <span class="join-node-title">${escapeHtml(String(title))}</span>
          <span class="join-node-meta">${escapeHtml(preview)}</span>
        </article>
      `;
    })
    .join("");

  return `<div class="join-node-column" data-join-side="${side}">${nodes}</div>`;
}

function buildJoinNodePreview(columns, values) {
  if (!columns.length || !values.length) {
    return "No columns available.";
  }

  return columns
    .slice(0, 3)
    .map((column, index) => `${column}: ${String(values[index] ?? "-")}`)
    .join(" | ");
}

function scheduleJoinConnectorRender() {
  if (!elements.joinVisualizer) {
    return;
  }

  if (state.joinConnectorFrame) {
    cancelAnimationFrame(state.joinConnectorFrame);
  }

  state.joinConnectorFrame = requestAnimationFrame(() => {
    state.joinConnectorFrame = 0;
    renderJoinConnectorPaths();
  });
}

function renderJoinConnectorPaths() {
  if (!elements.joinVisualizer) {
    return;
  }

  const diagram = elements.joinVisualizer.querySelector("[data-join-diagram]");
  const svg = diagram?.querySelector(".join-lines");
  if (!(diagram instanceof HTMLElement) || !(svg instanceof SVGElement)) {
    return;
  }

  const diagramBounds = diagram.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${diagramBounds.width} ${diagramBounds.height}`);

  const leftLookup = new Map(
    Array.from(diagram.querySelectorAll('.join-node[data-join-side="left"]')).map((node) => [
      node.getAttribute("data-rowid"),
      node
    ])
  );
  const rightLookup = new Map(
    Array.from(diagram.querySelectorAll('.join-node[data-join-side="right"]')).map((node) => [
      node.getAttribute("data-rowid"),
      node
    ])
  );
  const paths = [];

  state.joinMatches.forEach((match) => {
    const leftNode = leftLookup.get(String(match.left));
    const rightNode = rightLookup.get(String(match.right));
    if (!(leftNode instanceof HTMLElement) || !(rightNode instanceof HTMLElement)) {
      return;
    }

    const leftBounds = leftNode.getBoundingClientRect();
    const rightBounds = rightNode.getBoundingClientRect();
    const x1 = leftBounds.right - diagramBounds.left;
    const y1 = leftBounds.top + leftBounds.height / 2 - diagramBounds.top;
    const x2 = rightBounds.left - diagramBounds.left;
    const y2 = rightBounds.top + rightBounds.height / 2 - diagramBounds.top;
    const controlOffset = Math.max(32, (x2 - x1) / 2);

    paths.push(
      `<path class="join-line" d="M ${x1} ${y1} C ${x1 + controlOffset} ${y1}, ${x2 - controlOffset} ${y2}, ${x2} ${y2}" />`
    );
  });

  svg.innerHTML = paths.join("");
}

function renderJoinTable(columns, rows, matchSet) {
  if (!rows.length) {
    return '<p class="empty">No rows.</p>';
  }

  const headers = columns
    .filter((column) => column !== "__rowid__")
    .map((column) => `<th>${escapeHtml(column)}</th>`)
    .join("");

  const body = rows
    .map((row) => {
      const rowId = Number(row[0]);
      const cells = row
        .slice(1)
        .map((value) => `<td>${escapeHtml(String(value))}</td>`)
        .join("");
      const className = matchSet.has(rowId) ? "match-row" : "";
      return `<tr class="${className}">${cells}</tr>`;
    })
    .join("");

  return `<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderError(message, hintText = "Check the SQL syntax and table or column names, then try again.") {
  if (elements.resultContainer) {
    elements.resultContainer.innerHTML = `
      <div class="error-box">
        <p class="error-title">Query could not be executed.</p>
        <p>${escapeHtml(message)}</p>
        <p class="error-hint">${escapeHtml(hintText)}</p>
      </div>
    `;
  }
  if (elements.explanationText) {
    elements.explanationText.textContent = "The query could not be executed. Fix the SQL and run again.";
  }
  if (elements.clauseList) {
    elements.clauseList.innerHTML = `<div class="error-box"><p>${escapeHtml(hintText)}</p></div>`;
  }
  if (elements.stepExecution) {
    elements.stepExecution.innerHTML = '<p class="empty">No execution preview because the query failed.</p>';
  }
  if (elements.joinVisualizer) {
    elements.joinVisualizer.innerHTML = '<p class="empty">No JOIN visualization because the query failed.</p>';
  }
  state.joinMatches = [];
}

function renderTableMarkup(columns, rows) {
  const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((value) => `<td>${escapeHtml(String(value))}</td>`).join("")}</tr>`
    )
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${columns.length}">No rows returned.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function setStatus(message, type = "") {
  if (!elements.statusBar) {
    return;
  }

  elements.statusBar.textContent = message;
  elements.statusBar.classList.remove("ok", "error", "loading");
  if (type) {
    elements.statusBar.classList.add(type);
  }
}

function getCurrentQuery() {
  if (state.editor) {
    return state.editor.getValue().trim();
  }

  if (elements.queryInput) {
    return elements.queryInput.value.trim();
  }

  return (readStorage(STORAGE_QUERY_KEY) || "").trim();
}

function setQueryValue(query) {
  writeStorage(STORAGE_QUERY_KEY, query);
  resetHistoryNavigation();

  if (state.editor) {
    state.editor.setValue(query);
    state.editor.focus();
    return;
  }

  if (elements.queryInput) {
    elements.queryInput.value = query;
    elements.queryInput.focus();
  }
}

function setLoadingState(isLoading) {
  state.isLoading = isLoading;

  if (document.body) {
    document.body.classList.toggle("is-loading", isLoading);
  }

  if (elements.runQueryBtn) {
    elements.runQueryBtn.disabled = isLoading;
  }

  if (elements.resetDbBtn) {
    elements.resetDbBtn.disabled = isLoading;
  }

  if (elements.loadExampleBtn) {
    elements.loadExampleBtn.disabled = isLoading;
  }

  if (state.editor) {
    state.editor.setOption("readOnly", isLoading ? "nocursor" : false);
  }
}

function handleEditorHistoryNavigation(editor, direction) {
  if (editor.listSelections().length !== 1 || editor.somethingSelected()) {
    return false;
  }

  const cursor = editor.getCursor();
  const lastLine = editor.lastLine();
  if (direction === "up" && cursor.line !== 0) {
    return false;
  }
  if (direction === "down" && cursor.line !== lastLine) {
    return false;
  }

  return navigateHistory(direction, {
    getValue: () => editor.getValue(),
    setValue: (query) => {
      editor.setValue(query);
      const targetLine = direction === "up" ? 0 : editor.lastLine();
      const targetCh = direction === "up" ? 0 : editor.getLine(editor.lastLine()).length;
      editor.setCursor({ line: targetLine, ch: targetCh });
    }
  });
}

function handleTextareaHistoryNavigation(input, direction) {
  const selectionStart = input.selectionStart ?? 0;
  const selectionEnd = input.selectionEnd ?? selectionStart;
  if (selectionStart !== selectionEnd) {
    return false;
  }

  const value = input.value;
  const isAtStart = selectionStart === 0;
  const isAtEnd = selectionEnd === value.length;
  if (direction === "up" && !isAtStart) {
    return false;
  }
  if (direction === "down" && !isAtEnd) {
    return false;
  }

  return navigateHistory(direction, {
    getValue: () => input.value,
    setValue: (query) => {
      input.value = query;
      const nextCursor = direction === "up" ? 0 : input.value.length;
      input.selectionStart = nextCursor;
      input.selectionEnd = nextCursor;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

function navigateHistory(direction, adapter) {
  const history = readHistory();
  if (!history.length) {
    return false;
  }

  if (direction === "up") {
    if (state.historyCursor === -1) {
      state.historyDraft = adapter.getValue();
    }

    if (state.historyCursor < history.length - 1) {
      state.historyCursor += 1;
      state.isHistoryNavigating = true;
      try {
        adapter.setValue(history[state.historyCursor].query);
      } finally {
        state.isHistoryNavigating = false;
      }
      return true;
    }
    return false;
  }

  if (state.historyCursor > 0) {
    state.historyCursor -= 1;
    state.isHistoryNavigating = true;
    try {
      adapter.setValue(history[state.historyCursor].query);
    } finally {
      state.isHistoryNavigating = false;
    }
    return true;
  }

  if (state.historyCursor === 0) {
    state.historyCursor = -1;
    state.isHistoryNavigating = true;
    try {
      adapter.setValue(state.historyDraft);
    } finally {
      state.isHistoryNavigating = false;
    }
    return true;
  }

  return false;
}

function resetHistoryNavigation() {
  state.historyCursor = -1;
  state.historyDraft = "";
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

function renderDifficultyMeter(analysis, options = {}) {
  if (!elements.difficultyBadge || !elements.difficultySummary) {
    return;
  }

  if (!analysis || !analysis.difficulty) {
    elements.difficultyBadge.textContent = "Waiting for a query";
    elements.difficultyBadge.className = "difficulty-badge";
    elements.difficultySummary.textContent =
      "Explanation, execution, and JOIN previews support basic SELECT queries best.";
    return;
  }

  elements.difficultyBadge.textContent = analysis.difficulty.label;
  elements.difficultyBadge.className = `difficulty-badge difficulty-${analysis.difficulty.tone}`;

  const suffix = options.isLive
    ? "Preview based on the current editor draft. Explanation, execution, and JOIN previews support basic SELECT queries best."
    : "Explanation, execution, and JOIN previews support basic SELECT queries best.";
  elements.difficultySummary.textContent = `${analysis.difficulty.summary} ${suffix}`;
}

function buildSqlErrorGuidance(rawQuery, errorMessage) {
  const normalizedQuery = normalizeSql(rawQuery).toLowerCase();
  const loweredMessage = String(errorMessage || "").toLowerCase();
  const nearMatch = /near "([^"]+)"/i.exec(errorMessage || "");
  const hints = [];

  if (nearMatch) {
    hints.push(`Check the SQL near "${nearMatch[1]}".`);
  }

  if (loweredMessage.includes("syntax error")) {
    hints.push("Check the clause order around SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY, and LIMIT.");
  }

  if (loweredMessage.includes("no such table")) {
    hints.push("Use one of the sample tables: students, courses, or enrollments.");
  }

  if (loweredMessage.includes("no such column")) {
    hints.push("Verify the column name and any table aliases used in SELECT, WHERE, or JOIN.");
  }

  if (normalizedQuery.includes(" join ") && !normalizedQuery.includes(" on ")) {
    hints.push("Each JOIN in this playground needs an ON condition.");
  }

  if (!hints.length) {
    hints.push("Check syntax near WHERE or JOIN and confirm your table and column names.");
  }

  return {
    short: hints[0],
    detail: hints.join(" ")
  };
}

function insertTextAtCursor(input, text) {
  const selectionStart = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? selectionStart;
  const nextValue =
    input.value.slice(0, selectionStart) + text + input.value.slice(selectionEnd);

  input.value = nextValue;
  input.selectionStart = selectionStart + text.length;
  input.selectionEnd = selectionStart + text.length;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setRunState(hasRun) {
  state.hasRun = hasRun;
  if (hasRun) {
    writeSession(SESSION_HAS_RUN_KEY, "1");
  }

  if (document.body) {
    document.body.classList.toggle("has-run-query", hasRun);
  }
}

function setExecutionTime(elapsedMs, rowCount, isError = false) {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const payload = {
    elapsedMs: safeElapsedMs,
    rowCount: Number(rowCount) || 0,
    isError: Boolean(isError)
  };
  writeStorage(STORAGE_LAST_EXECUTION_KEY, JSON.stringify(payload));

  if (!elements.execTimeLabel) {
    return;
  }

  const rowText = payload.rowCount ? ` | Rows: ${payload.rowCount}` : "";
  const prefix = payload.isError ? "Execution failed in" : "Execution time:";
  elements.execTimeLabel.textContent = `${prefix} ${payload.elapsedMs.toFixed(2)} ms${rowText}`;
  elements.execTimeLabel.classList.toggle("error", payload.isError);
}

function restoreExecutionTime() {
  if (!elements.execTimeLabel) {
    return;
  }

  const raw = readStorage(STORAGE_LAST_EXECUTION_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    setExecutionTime(Number(parsed.elapsedMs) || 0, Number(parsed.rowCount) || 0, Boolean(parsed.isError));
  } catch (_error) {
    elements.execTimeLabel.textContent = "Execution time: -";
  }
}

function renderHistory() {
  if (!elements.historyContainer) {
    return;
  }

  const history = readHistory();
  if (!history.length) {
    elements.historyContainer.innerHTML = '<p class="empty">Your executed queries will appear here.</p>';
    return;
  }

  elements.historyContainer.innerHTML = history
    .map((entry, index) => {
      const compactQuery = entry.query.replace(/\s+/g, " ").trim();
      const preview = compactQuery.length > 130 ? `${compactQuery.slice(0, 127)}...` : compactQuery;
      const status = entry.success ? "ok" : "error";
      const rowText = entry.rowCount ? `${entry.rowCount} rows` : "0 rows";
      const meta = `${formatTimestamp(entry.timestamp)} | ${entry.elapsedMs.toFixed(2)} ms | ${rowText} | ${status}`;

      return `
        <button class="history-item" type="button" data-history-index="${index}">
          <span class="history-meta">${escapeHtml(meta)}</span>
          <code class="history-query">${escapeHtml(preview)}</code>
        </button>
      `;
    })
    .join("");
}

function addHistoryEntry(entry) {
  const normalizedQuery = (entry.query || "").trim();
  if (!normalizedQuery) {
    return;
  }

  const history = readHistory();
  if (history[0] && history[0].query === normalizedQuery) {
    history.shift();
  }

  history.unshift({
    query: normalizedQuery,
    elapsedMs: Number(entry.elapsedMs) || 0,
    rowCount: Number(entry.rowCount) || 0,
    success: Boolean(entry.success),
    error: entry.error || "",
    timestamp: new Date().toISOString()
  });

  if (history.length > MAX_HISTORY_ITEMS) {
    history.length = MAX_HISTORY_ITEMS;
  }

  writeHistory(history);
  renderHistory();
}

function readHistory() {
  const raw = readStorage(STORAGE_HISTORY_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry.query === "string" &&
        typeof entry.elapsedMs === "number" &&
        typeof entry.rowCount === "number" &&
        typeof entry.success === "boolean"
    );
  } catch (_error) {
    return [];
  }
}

function writeHistory(history) {
  writeStorage(STORAGE_HISTORY_KEY, JSON.stringify(history));
}

function formatTimestamp(isoString) {
  const parsedDate = new Date(isoString);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Unknown time";
  }

  return parsedDate.toLocaleString();
}

function normalizeSql(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;$/, "");
}

function stripTrailingSemicolon(sql) {
  return sql.trim().replace(/;$/, "");
}

function isSafeIdentifier(text) {
  return /^[a-z_][a-z0-9_]*$/i.test(text);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_error) {
    // Ignore storage write errors and keep app functional.
  }
}

function readSession(key) {
  try {
    return sessionStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch (_error) {
    // Ignore session write errors and keep app functional.
  }
}
