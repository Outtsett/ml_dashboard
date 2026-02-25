Architecture & Structural Concepts
- Architecture — The high‑level blueprint of system structure, boundaries, flows, and constraints.
- Framework — A pre‑structured environment that dictates conventions and provides scaffolding.
- Design Pattern — A reusable structural or behavioral solution to a recurring problem.
- Microservices — Independently deployable services with explicit boundaries.
- Monolith — A single, unified codebase with tightly coupled components.
- Modularization — Decomposing a system into independent, composable units.
- Abstraction — Hiding complexity behind simplified interfaces.
- Encapsulation — Bundling data and behavior while restricting external access.
- Separation of Concerns — Ensuring each component has one responsibility.
- Dependency Injection — Supplying dependencies externally to reduce coupling.
- Inversion of Control — Framework or container controls execution flow.
- Event‑Driven Architecture — Components communicate via events rather than direct calls.
- Layered Architecture — System organized into hierarchical layers (UI → Logic → Data).
- Hexagonal Architecture — Core domain isolated from external adapters.
- Domain‑Driven Design — Modeling software around domain concepts.
- Service Mesh — Infrastructure layer for service‑to‑service communication.
- Scalability — Ability to grow without degrading performance.
- Fault Tolerance — Ability to continue operating despite failures.
- State Management — How data persists and flows through the system.
- Idempotency — Operation can be repeated without changing the result.

Development Lifecycle & Process
- SDLC — The full life of software from conception to retirement.
- Agile — Iterative, adaptive development methodology.
- Scrum — Agile framework with sprints, roles, and ceremonies.
- Kanban — Flow‑based work visualization and optimization.
- CI/CD — Automated integration, testing, and deployment pipeline.
- Version Control — Tracking changes across time (Git).
- Branching Strategy — Rules for how code branches are created and merged.
- Code Review — Peer validation of correctness and style.
- Refactoring — Improving structure without changing behavior.
- Technical Debt — Accumulated shortcuts that hinder future development.
- Release Management — Coordinating versions, deployments, and rollouts.
- Rollback — Reverting to a previous stable version.
- Hotfix — Emergency patch applied outside normal release cycles.
- Backlog — Prioritized list of work items.
- User Story — A feature described from the user’s perspective.
- Acceptance Criteria — Conditions that must be met for completion.
- Postmortem — Analysis after an incident to prevent recurrence.

Implementation Concepts
- Algorithm — A step‑by‑step procedure for solving a problem.
- Data Structure — A way of organizing data for efficient access.
- Class — Blueprint for objects.
- Object — Instance of a class.
- Interface — Contract defining expected behavior.
- Module — Self‑contained unit of code.
- Function — Reusable block of logic.
- Constructor — Initializes a new object.
- Initialization — Setting up initial state before use.
- Configuration — Adjusting settings to shape behavior.
- Compilation — Translating code into machine‑executable form.
- Runtime — The environment where code executes.
- Library — Reusable code packaged for consumption.
- SDK — Tools + libraries for building on a platform.
- API — Contract for interacting with a system.
- Endpoint — A specific callable API route.
- Controller — Handles incoming requests.
- Service — Encapsulates business logic.
- Repository — Abstracts data persistence.
- Adapter — Converts one interface to another.
- Facade — Simplifies a complex subsystem.
- Singleton — Ensures only one instance exists.
- Factory — Creates objects without exposing construction logic.
- Observer — Reacts to changes in another object.
- Decorator — Adds behavior without modifying the original.

Integration & Communication
- REST — Resource‑based HTTP API style.
- GraphQL — Query‑based API allowing clients to specify data shape.
- gRPC — High‑performance RPC framework.
- Webhooks — Push‑based event notifications.
- WebSockets — Persistent bidirectional communication channel.
- ETL — Extract → Transform → Load data pipeline.
- Serialization — Converting objects to transferable formats.
- OAuth — Delegated authorization.
- JWT — Token‑based authentication.
- CORS — Cross‑origin request rules.
- Rate Limiting — Restricting request frequency.

Testing & Quality
- Unit Test — Tests a single function or module.
- Integration Test — Tests interactions between components.
- End‑to‑End Test — Tests full system behavior.
- Regression Test — Ensures old features still work.
- Load Test — Measures performance under expected load.
- Stress Test — Pushes system beyond limits.
- Mocking — Simulating dependencies.
- Static Analysis — Code inspection without running it.
- Profiling — Measuring performance characteristics.
- Validation — Ensures requirements are met.
- Verification — Ensures implementation works correctly.

Data & Storage
- Schema — Structure of data.
- Index — Data structure for fast lookup.
- Transaction — Atomic unit of work.
- ACID — Guarantees for reliable transactions.
- Sharding — Splitting data across nodes.
- Replication — Copying data for redundancy.
- Caching — Storing frequently accessed data.
- Data Lake — Raw, unstructured data storage.
- Data Warehouse — Structured analytical storage.

DevOps & Infrastructure
- IaC — Managing infrastructure through code.
- Container — Isolated runtime environment.
- Kubernetes — Orchestrates containers.
- Cluster — Group of machines acting as one.
- Service Mesh — Manages service‑to‑service communication.
- Monitoring — Tracking system health.
- Logging — Recording system events.
- Observability — Ability to infer internal state from outputs.
- Autoscaling — Automatic resource adjustment.
- Secrets Management — Secure handling of credentials.

Security
- Authentication — Verifying identity.
- Authorization — Verifying permissions.
- Encryption — Protecting data via cryptography.
- Hashing — One‑way transformation for integrity.
- Threat Modeling — Identifying potential attack vectors.
- RBAC — Role‑based access control.
- IAM — Identity and access management.

Frontend Concepts
- DOM — Browser’s representation of the page.
- Virtual DOM — Lightweight copy used for efficient updates.
- Component — Reusable UI unit.
- State — Internal data of a component.
- Props — External inputs to a component.
- SSR — Server‑side rendering.
- CSR — Client‑side rendering.
- Hydration — Attaching JS to server‑rendered HTML.
- Accessibility — Ensuring usability for all users.

Backend Concepts
- Middleware — Logic executed between request and handler.
- ORM — Maps objects to database tables.
- Message Queue — Asynchronous communication channel.
- Cron Job — Scheduled task.
- Worker — Background job processor.
- Connection Pool — Reusable database connections.

Cloud & Distributed Systems
- Serverless — Functions executed on demand.
- Event Stream — Continuous flow of events.
- Pub/Sub — Publish‑subscribe messaging model.
- CDN — Distributed content delivery network.
- Edge Computing — Compute near the user.

Build & Packaging
- Compiler — Converts source to machine code.
- Transpiler — Converts between languages/versions.
- Minification — Removing unnecessary characters.
- Bundling — Combining files into one artifact.
- Tree Shaking — Removing unused code.
- Package Manager — Installs and manages dependencies.

Governance & Analysis
- Audit — Formal review for compliance and traceability.
- Assessment — Evaluating current state or risk.
- Metrics — Quantitative indicators of performance.
- SLA/SLO/SLI — Service reliability contracts and measurements.
- Traceability — Ability to follow data or logic end‑to‑end.

Action Verbs (Developer Context)
- Construct — Assemble components into a structure.
- Develop — Iteratively expand functionality.
- Create — Bring something new into existence.
- Initialize — Set up initial state.
- Configure — Adjust settings to shape behavior.
- Analyze — Break down to understand.
- Validate — Check against requirements.
- Verify — Check correctness of behavior.
- Deploy — Move code into production.
- Debug — Identify and fix defects.
- Optimize — Improve performance or efficiency.
- Refactor — Restructure without changing behavior.
- Monitor — Observe system health.
- Manage — Direct ongoing operations.
