// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract ClarityEscrow {
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        address client;
        address provider;
        address evaluator;
        uint256 budget;
        uint64 expiresAt;
        bytes32 descriptionCid;
        bytes32 deliverableCid;
        JobStatus status;
    }

    uint256 public immutable platformFeeBP;
    uint256 public immutable evaluatorFeeBP;
    address public immutable treasury;
    IERC20Minimal public immutable token;
    uint256 public jobCount;

    mapping(uint256 => Job) public jobs;

    error InvalidAddress();
    error InvalidState();
    error Unauthorized();
    error InvalidBudget();
    error TransferFailed();
    error BudgetMismatch();
    error JobNotExpired();
    error JobExpired();

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address provider,
        address evaluator,
        bytes32 descriptionCid,
        uint64 expiresAt
    );
    event JobBudgetSet(uint256 indexed jobId, uint256 budget);
    event JobFunded(uint256 indexed jobId, uint256 budget);
    event WorkSubmitted(uint256 indexed jobId, bytes32 deliverableCid);
    event JobCompleted(uint256 indexed jobId, uint256 providerAmount, uint256 evaluatorAmount, uint256 platformAmount);
    event JobRejected(uint256 indexed jobId);
    event JobRefunded(uint256 indexed jobId, uint256 amount);

    constructor(address token_, address treasury_, uint256 platformFeeBP_, uint256 evaluatorFeeBP_) {
        if (token_ == address(0) || treasury_ == address(0)) revert InvalidAddress();
        if (platformFeeBP_ + evaluatorFeeBP_ > 10_000) revert InvalidBudget();

        token = IERC20Minimal(token_);
        treasury = treasury_;
        platformFeeBP = platformFeeBP_;
        evaluatorFeeBP = evaluatorFeeBP_;
    }

    function createJob(address provider, address evaluator, uint64 expiresAt, bytes32 descriptionCid)
        external
        returns (uint256 jobId)
    {
        if (provider == address(0) || evaluator == address(0)) revert InvalidAddress();
        if (provider == evaluator || provider == msg.sender || evaluator == msg.sender) revert InvalidAddress();
        if (expiresAt <= block.timestamp) revert InvalidState();

        jobId = ++jobCount;
        jobs[jobId] = Job({
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            budget: 0,
            expiresAt: expiresAt,
            descriptionCid: descriptionCid,
            deliverableCid: bytes32(0),
            status: JobStatus.Open
        });

        emit JobCreated(jobId, msg.sender, provider, evaluator, descriptionCid, expiresAt);
    }

    function setBudget(uint256 jobId, uint256 amount) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert Unauthorized();
        if (job.status != JobStatus.Open) revert InvalidState();
        if (amount == 0) revert InvalidBudget();
        if (_isExpired(job)) revert JobExpired();

        job.budget = amount;
        emit JobBudgetSet(jobId, amount);
    }

    function fund(uint256 jobId, uint256 expectedBudget) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert Unauthorized();
        if (job.status != JobStatus.Open) revert InvalidState();
        if (_isExpired(job)) revert JobExpired();
        if (job.budget == 0) revert InvalidBudget();
        if (expectedBudget != job.budget) revert BudgetMismatch();

        if (!token.transferFrom(msg.sender, address(this), job.budget)) revert TransferFailed();
        job.status = JobStatus.Funded;
        emit JobFunded(jobId, job.budget);
    }

    function submitWork(uint256 jobId, bytes32 deliverableCid) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.provider) revert Unauthorized();
        if (job.status != JobStatus.Funded) revert InvalidState();
        if (_isExpired(job)) revert JobExpired();
        if (deliverableCid == bytes32(0)) revert InvalidState();

        job.deliverableCid = deliverableCid;
        job.status = JobStatus.Submitted;
        emit WorkSubmitted(jobId, deliverableCid);
    }

    function completeJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.evaluator) revert Unauthorized();
        if (job.status != JobStatus.Submitted) revert InvalidState();
        if (_isExpired(job)) revert JobExpired();

        uint256 platformAmount = (job.budget * platformFeeBP) / 10_000;
        uint256 evaluatorAmount = (job.budget * evaluatorFeeBP) / 10_000;
        uint256 providerAmount = job.budget - platformAmount - evaluatorAmount;

        job.status = JobStatus.Completed;

        if (!token.transfer(job.provider, providerAmount)) revert TransferFailed();
        if (!token.transfer(job.evaluator, evaluatorAmount)) revert TransferFailed();
        if (!token.transfer(treasury, platformAmount)) revert TransferFailed();

        emit JobCompleted(jobId, providerAmount, evaluatorAmount, platformAmount);
    }

    function rejectJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.evaluator) revert Unauthorized();
        if (job.status != JobStatus.Submitted) revert InvalidState();

        job.status = JobStatus.Rejected;
        if (!token.transfer(job.client, job.budget)) revert TransferFailed();

        emit JobRejected(jobId);
    }

    function claimRefund(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Funded) revert InvalidState();
        if (block.timestamp <= job.expiresAt) revert JobNotExpired();

        job.status = JobStatus.Expired;
        if (!token.transfer(job.client, job.budget)) revert TransferFailed();
        emit JobRefunded(jobId, job.budget);
    }

    function _isExpired(Job memory job) private view returns (bool) {
        return block.timestamp > job.expiresAt;
    }
}
